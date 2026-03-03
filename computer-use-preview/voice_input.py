"""Voice input using Google Cloud Speech-to-Text API.

Handles audio streaming from the frontend (WebSocket binary frames)
and returns transcribed text.
"""
import io
import os
import wave
import tempfile
from typing import Callable


class VoiceTranscriber:
    """Transcribes audio using Google Cloud Speech-to-Text."""

    def __init__(self):
        self._client = None
        self._available = False
        self._init_client()

    def _init_client(self):
        try:
            from google.cloud import speech
            self._client = speech.SpeechClient()
            self._available = True
            print("[VOICE] Google Cloud STT initialized")
        except Exception as e:
            print(f"[VOICE] STT unavailable ({e}), voice input disabled")

    @property
    def available(self) -> bool:
        return self._available

    def transcribe_audio(self, audio_data: bytes, sample_rate: int = 16000) -> str:
        """Transcribe raw audio bytes (PCM 16-bit mono).

        Args:
            audio_data: Raw PCM audio bytes or WAV file bytes
            sample_rate: Sample rate in Hz

        Returns:
            Transcribed text or empty string
        """
        if not self._available:
            return ""

        from google.cloud import speech

        # Check if it's a WAV file
        is_wav = audio_data[:4] == b'RIFF'
        if is_wav:
            encoding = speech.RecognitionConfig.AudioEncoding.LINEAR16
            # Parse WAV header for sample rate
            try:
                wav_io = io.BytesIO(audio_data)
                with wave.open(wav_io, 'rb') as wf:
                    sample_rate = wf.getframerate()
            except Exception:
                pass
        else:
            encoding = speech.RecognitionConfig.AudioEncoding.WEBM_OPUS
            sample_rate = 48000  # WebM Opus default

        audio = speech.RecognitionAudio(content=audio_data)
        config = speech.RecognitionConfig(
            encoding=encoding,
            sample_rate_hertz=sample_rate,
            language_code="en-US",
            enable_automatic_punctuation=True,
            model="latest_long",
            use_enhanced=True,
            alternative_language_codes=["hi-IN"],  # Hindi support
        )

        try:
            response = self._client.recognize(config=config, audio=audio)
            if response.results:
                transcript = " ".join(
                    result.alternatives[0].transcript
                    for result in response.results
                    if result.alternatives
                )
                print(f"[VOICE] Transcribed: {transcript[:80]}...")
                return transcript.strip()
            return ""
        except Exception as e:
            print(f"[VOICE] Transcription error: {e}")
            return ""

    def transcribe_streaming(self, audio_chunks: list[bytes], sample_rate: int = 16000) -> str:
        """Transcribe streaming audio chunks."""
        if not self._available:
            return ""

        from google.cloud import speech

        config = speech.RecognitionConfig(
            encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
            sample_rate_hertz=sample_rate,
            language_code="en-US",
            enable_automatic_punctuation=True,
        )
        streaming_config = speech.StreamingRecognitionConfig(
            config=config,
            interim_results=False,
        )

        def request_generator():
            yield speech.StreamingRecognizeRequest(streaming_config=streaming_config)
            for chunk in audio_chunks:
                yield speech.StreamingRecognizeRequest(audio_content=chunk)

        try:
            responses = self._client.streaming_recognize(requests=request_generator())
            transcript_parts = []
            for response in responses:
                for result in response.results:
                    if result.is_final and result.alternatives:
                        transcript_parts.append(result.alternatives[0].transcript)
            return " ".join(transcript_parts).strip()
        except Exception as e:
            print(f"[VOICE] Streaming transcription error: {e}")
            return ""

