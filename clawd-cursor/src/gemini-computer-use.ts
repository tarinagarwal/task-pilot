/**
 * Gemini Computer Use Brain
 *
 * Replaces Anthropic's native computer_use tool spec with a Gemini-powered
 * screenshot → vision analysis → action execution loop.
 *
 * Gemini doesn't have a native "computer use" tool, so we:
 *  1. Capture screenshot + a11y context
 *  2. Send to Gemini vision with a structured action prompt
 *  3. Parse the JSON action response
 *  4. Execute via NativeDesktop
 *  5. Repeat until done or max iterations
 *
 * Uses the same action format as AIBrain for consistency.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { NativeDesktop } from "./native-desktop";
import { AccessibilityBridge } from "./accessibility";
import { SafetyLayer } from "./safety";
import { normalizeKeyCombo } from "./keys";
import type { ClawdConfig, StepResult } from "./types";
import {
  type GeminiConfig,
  type GeminiMessage,
  buildGeminiConfig,
  geminiVisionCall,
  geminiTextCall,
  createImagePart,
  createTextPart,
} from "./gemini-client";

const MAX_ITERATIONS = 30;
const IS_MAC = os.platform() === "darwin";

const SYSTEM_PROMPT = IS_MAC
  ? `You are Gemini Cursor, an AI desktop automation agent on macOS.

=== RESPONSE FORMAT ===
Respond with ONLY valid JSON. One action per response. No markdown, no explanation outside JSON.

{"action":"screenshot","description":"..."}
{"action":"left_click","coordinate":[x,y],"description":"..."}
{"action":"right_click","coordinate":[x,y],"description":"..."}
{"action":"double_click","coordinate":[x,y],"description":"..."}
{"action":"type","text":"simple text to type","description":"..."}
{"action":"compose","content_type":"essay|letter|email|code|document","topic":"detailed description of what to write","description":"..."}
{"action":"key","text":"key_combo","description":"..."}
{"action":"scroll","coordinate":[x,y],"scroll_direction":"up|down","scroll_amount":5,"description":"..."}
{"action":"left_click_drag","start_coordinate":[x,y],"coordinate":[x,y],"description":"..."}
{"action":"wait","duration":2,"description":"..."}
{"action":"done","description":"..."}

=== CRITICAL RULES ===

**RULE 1 - COMPOSE vs TYPE (MOST IMPORTANT):**
- Use "type" ONLY for short, literal text (URLs, filenames, search queries, usernames, passwords)
- Use "compose" when asked to WRITE/CREATE/DRAFT any substantial content:
  * Essays, articles, stories
  * Letters, applications, emails
  * Code, scripts, documents
  * Reports, summaries, descriptions

EXAMPLES:
- "Type google.com" → {"action":"type","text":"google.com"}
- "Write an essay on WW2" → {"action":"compose","content_type":"essay","topic":"World War 2 - causes, major events, and impact on modern world"}
- "Write a leave application" → {"action":"compose","content_type":"letter","topic":"formal leave application requesting 5 days off addressed to manager"}
- "Search for cats" → {"action":"type","text":"cats"}

**RULE 2 - WORKFLOW:**
1. Take screenshot first to see current state
2. One action per response
3. Use keyboard shortcuts: Cmd+C, Cmd+V, Cmd+W, Cmd+Tab

**RULE 3 - COORDINATES:**
Coordinates are in screenshot space (auto-scaled)

**RULE 4 - COMPLETION:**
When task is complete: {"action":"done","description":"..."}

**RULE 5 - ERROR RECOVERY:**
NEVER repeat failed actions. Try alternatives.`
  : `You are Gemini Cursor, an AI desktop automation agent on Windows 11.

=== RESPONSE FORMAT ===
Respond with ONLY valid JSON. One action per response. No markdown, no explanation outside JSON.

{"action":"screenshot","description":"..."}
{"action":"left_click","coordinate":[x,y],"description":"..."}
{"action":"right_click","coordinate":[x,y],"description":"..."}
{"action":"double_click","coordinate":[x,y],"description":"..."}
{"action":"type","text":"simple text to type","description":"..."}
{"action":"compose","content_type":"essay|letter|email|code|document","topic":"detailed description of what to write","description":"..."}
{"action":"key","text":"key_combo","description":"..."}
{"action":"scroll","coordinate":[x,y],"scroll_direction":"up|down","scroll_amount":5,"description":"..."}
{"action":"left_click_drag","start_coordinate":[x,y],"coordinate":[x,y],"description":"..."}
{"action":"wait","duration":2,"description":"..."}
{"action":"done","description":"..."}

=== CRITICAL RULES ===

**RULE 1 - COMPOSE vs TYPE (MOST IMPORTANT):**
- Use "type" ONLY for short, literal text (URLs, filenames, search queries, usernames, passwords)
- Use "compose" when asked to WRITE/CREATE/DRAFT any substantial content:
  * Essays, articles, stories
  * Letters, applications, emails
  * Code, scripts, documents
  * Reports, summaries, descriptions

EXAMPLES:
- "Type google.com" → {"action":"type","text":"google.com"}
- "Write an essay on WW2" → {"action":"compose","content_type":"essay","topic":"World War 2 - causes, major events, and impact on modern world"}
- "Write a leave application" → {"action":"compose","content_type":"letter","topic":"formal leave application requesting 5 days off addressed to manager"}
- "Search for cats" → {"action":"type","text":"cats"}

**RULE 2 - WORKFLOW:**
1. Take screenshot first to see current state
2. One action per response
3. Use keyboard shortcuts: Ctrl+C, Ctrl+V, Alt+F4, Alt+Tab
4. Win11: taskbar BOTTOM centered, system tray bottom-right

**RULE 3 - COORDINATES:**
Coordinates are in screenshot space (auto-scaled)

**RULE 4 - COMPLETION:**
When task is complete: {"action":"done","description":"..."}

**RULE 5 - ERROR RECOVERY:**
NEVER repeat failed actions. Try alternatives.`;

export interface GeminiComputerUseResult {
  success: boolean;
  steps: StepResult[];
  llmCalls: number;
}

export class GeminiComputerUseBrain {
  private config: ClawdConfig;
  private geminiConfig: GeminiConfig;
  private desktop: NativeDesktop;
  private a11y: AccessibilityBridge;
  private safety: SafetyLayer;
  private screenWidth: number;
  private screenHeight: number;
  private llmWidth: number;
  private llmHeight: number;
  private scaleFactor: number;

  constructor(
    config: ClawdConfig,
    desktop: NativeDesktop,
    a11y: AccessibilityBridge,
    safety: SafetyLayer,
    geminiConfig?: Partial<GeminiConfig>,
  ) {
    this.config = config;
    this.desktop = desktop;
    this.a11y = a11y;
    this.safety = safety;
    this.geminiConfig = buildGeminiConfig(geminiConfig);

    const screen = desktop.getScreenSize();
    this.screenWidth = screen.width;
    this.screenHeight = screen.height;

    const LLM_WIDTH = 1280;
    this.scaleFactor = screen.width > LLM_WIDTH ? screen.width / LLM_WIDTH : 1;
    this.llmWidth = Math.min(screen.width, LLM_WIDTH);
    this.llmHeight = Math.round(screen.height / this.scaleFactor);

    console.log(
      `   🖥️  Gemini Computer Use: ${this.llmWidth}x${this.llmHeight} display ` +
        `(scale ${this.scaleFactor.toFixed(2)}x from ${this.screenWidth}x${this.screenHeight})`,
    );
  }

  /**
   * Check if Gemini computer use is available.
   */
  static isSupported(): boolean {
    const hasVertexAI =
      process.env.USE_VERTEXAI === "true" && !!process.env.VERTEXAI_PROJECT;
    const hasGeminiKey = !!process.env.GEMINI_API_KEY;
    return hasVertexAI || hasGeminiKey;
  }

  /**
   * Execute a subtask using the Gemini vision loop.
   */
  async executeSubtask(
    subtask: string,
    debugDir: string | null,
    subtaskIndex: number,
    priorSteps?: string[],
  ): Promise<GeminiComputerUseResult> {
    const steps: StepResult[] = [];
    let llmCalls = 0;
    const messages: GeminiMessage[] = [];

    console.log(`   🖥️  Gemini Computer Use: "${subtask}"`);

    // Build initial user message
    let taskMessage = subtask;
    if (priorSteps && priorSteps.length > 0) {
      taskMessage =
        `CONTEXT — These steps were already completed:\n` +
        priorSteps.map((s, i) => `${i + 1}. ${s}`).join("\n") +
        `\n\nThe app is ALREADY OPEN and FOCUSED. Start working immediately.\n\nYOUR TASK: ${subtask}`;
    }

    // Start with a screenshot so Gemini can see the screen
    const initialScreenshot = await this.desktop.captureForLLM();
    if (debugDir)
      this.saveDebug(
        initialScreenshot.buffer,
        debugDir,
        subtaskIndex,
        0,
        "init",
      );

    const a11yContext = await this.getA11yContext();

    messages.push({
      role: "user",
      parts: [
        createImagePart(
          initialScreenshot.buffer,
          initialScreenshot.format as "png" | "jpeg",
        ),
        createTextPart(
          `Screen: ${this.llmWidth}x${this.llmHeight}\n` +
            `${a11yContext}\n\nTASK: ${taskMessage}\n\n` +
            `Look at the screenshot and decide your first action.`,
        ),
      ],
    });

    let consecutiveErrors = 0;
    let lastActionSig = "";
    let repeatCount = 0;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      llmCalls++;
      console.log(`   📡 Gemini vision call ${i + 1}...`);

      let responseText: string;
      try {
        responseText = await geminiVisionCall(
          this.geminiConfig,
          SYSTEM_PROMPT,
          messages,
          2048,
        );
      } catch (err: any) {
        const errStr = String(err);
        // Retry on 429 rate limit with exponential backoff
        if (errStr.includes("429") || errStr.includes("RESOURCE_EXHAUSTED")) {
          const backoff = Math.min(
            5000 * Math.pow(2, consecutiveErrors),
            60000,
          );
          console.log(
            `   ⏳ Rate limited (429) — retrying in ${Math.round(backoff / 1000)}s...`,
          );
          await this.delay(backoff);
          consecutiveErrors++;
          if (consecutiveErrors >= 5) {
            console.log(`   ❌ Rate limit persists after retries — aborting`);
            steps.push({
              action: "error",
              description: `Rate limit: ${err}`,
              success: false,
              timestamp: Date.now(),
            });
            return { success: false, steps, llmCalls };
          }
          i--; // retry this iteration
          continue;
        }
        console.log(`   ❌ Gemini API error: ${err}`);
        steps.push({
          action: "error",
          description: `Gemini API error: ${err}`,
          success: false,
          timestamp: Date.now(),
        });
        return { success: false, steps, llmCalls };
      }

      if (!responseText.trim()) {
        console.log(`   ⚠️ Empty Gemini response`);
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          return { success: false, steps, llmCalls };
        }
        continue;
      }

      // Add assistant response to conversation
      messages.push({
        role: "assistant",
        parts: [createTextPart(responseText)],
      });

      // Parse the JSON action
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log(
          `   ⚠️ No JSON in response: ${responseText.substring(0, 100)}`,
        );
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          return { success: false, steps, llmCalls };
        }
        // Ask Gemini to try again
        messages.push({
          role: "user",
          parts: [
            createTextPart(
              "Please respond with ONLY valid JSON. No markdown, no explanation.",
            ),
          ],
        });
        continue;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        console.log(`   ⚠️ Invalid JSON: ${jsonMatch[0].substring(0, 100)}`);
        consecutiveErrors++;
        messages.push({
          role: "user",
          parts: [
            createTextPart(
              "That was invalid JSON. Please respond with valid JSON only.",
            ),
          ],
        });
        continue;
      }

      consecutiveErrors = 0;
      const action = parsed.action;
      const description = parsed.description || action;
      console.log(`   💬 Gemini: ${description}`);

      // Handle "done"
      if (action === "done") {
        console.log(`   ✅ Gemini Computer Use: subtask complete`);
        steps.push({
          action: "done",
          description,
          success: true,
          timestamp: Date.now(),
        });
        return { success: true, steps, llmCalls };
      }

      // Handle "screenshot" — just capture and send back
      if (action === "screenshot") {
        const ss = await this.desktop.captureForLLM();
        if (debugDir)
          this.saveDebug(ss.buffer, debugDir, subtaskIndex, i, "ss");
        const ctx = await this.getA11yContext();
        messages.push({
          role: "user",
          parts: [
            createImagePart(ss.buffer, ss.format),
            createTextPart(
              `Screen: ${this.llmWidth}x${this.llmHeight}\n${ctx}\nWhat's your next action?`,
            ),
          ],
        });
        steps.push({
          action: "screenshot",
          description,
          success: true,
          timestamp: Date.now(),
        });
        continue;
      }

      // Handle "wait"
      if (action === "wait") {
        const dur = parsed.duration || 2;
        console.log(`   ⏳ Waiting ${dur}s...`);
        await this.delay(dur * 1000);
        // Take screenshot after wait
        const ss = await this.desktop.captureForLLM();
        if (debugDir)
          this.saveDebug(ss.buffer, debugDir, subtaskIndex, i, "wait");
        messages.push({
          role: "user",
          parts: [
            createImagePart(ss.buffer, ss.format),
            createTextPart(
              `Waited ${dur}s. Here's the current screen. What's next?`,
            ),
          ],
        });
        steps.push({
          action: "wait",
          description,
          success: true,
          timestamp: Date.now(),
        });
        continue;
      }

      // Execute the action
      const result = await this.executeAction(parsed);
      console.log(`   ${result.error ? "❌" : "✅"} ${result.description}`);
      steps.push({
        action,
        description: result.description,
        success: !result.error,
        error: result.error,
        timestamp: Date.now(),
      });

      // Loop detection
      const sig = `${action}|${JSON.stringify(parsed.coordinate || "")}|${(parsed.text || "").slice(0, 30)}`;
      if (sig === lastActionSig) {
        repeatCount++;
        if (repeatCount >= 4) {
          console.log(`   ♻️ Loop detected — forcing recovery`);
          repeatCount = 0;
          lastActionSig = "";
        }
      } else {
        lastActionSig = sig;
        repeatCount = 1;
      }

      if (result.error) {
        consecutiveErrors++;
        if (consecutiveErrors >= 5) {
          console.log(`   ❌ Too many consecutive errors — aborting`);
          return { success: false, steps, llmCalls };
        }
      }

      // Take screenshot after action and send back to Gemini
      const delayMs =
        action === "key" && parsed.text?.toLowerCase().includes("super")
          ? 600
          : action === "type"
            ? 50
            : 150;
      await this.delay(delayMs);

      const ss = await this.desktop.captureForLLM();
      if (debugDir)
        this.saveDebug(ss.buffer, debugDir, subtaskIndex, i, action);
      const ctx = await this.getA11yContext();

      const feedback = result.error
        ? `Error: ${result.error}\nTry a different approach.`
        : `Action executed successfully.`;

      messages.push({
        role: "user",
        parts: [
          createImagePart(ss.buffer, ss.format),
          createTextPart(
            `${feedback}\nScreen: ${this.llmWidth}x${this.llmHeight}\n${ctx}\n` +
              `What's your next action? If the task is complete, respond with {"action":"done","description":"..."}.`,
          ),
        ],
      });
    }

    console.log(`   ⚠️ Max iterations (${MAX_ITERATIONS}) reached`);
    return { success: false, steps, llmCalls };
  }

  // ─── Action Execution ──────────────────────────────────────────

  private async executeAction(
    parsed: any,
  ): Promise<{ description: string; error?: string }> {
    const { action, coordinate, start_coordinate, text } = parsed;

    // Safety check
    const actionDesc = text || action;
    if (this.safety.isBlocked(actionDesc)) {
      return {
        description: `BLOCKED: ${actionDesc}`,
        error: `Blocked by safety layer`,
      };
    }

    try {
      switch (action) {
        case "left_click": {
          const [x, y] = this.scale(coordinate);
          await this.desktop.mouseClick(x, y);
          return { description: `Click at (${x}, ${y})` };
        }
        case "right_click": {
          const [x, y] = this.scale(coordinate);
          await this.desktop.mouseRightClick(x, y);
          return { description: `Right click at (${x}, ${y})` };
        }
        case "double_click": {
          const [x, y] = this.scale(coordinate);
          await this.desktop.mouseDoubleClick(x, y);
          return { description: `Double click at (${x}, ${y})` };
        }
        case "type": {
          if (!text) return { description: "Type: empty", error: "No text" };
          await this.desktop.typeText(text);
          return {
            description: `Typed "${text.substring(0, 50)}${text.length > 50 ? "..." : ""}"`,
          };
        }
        case "compose": {
          const contentType = parsed.content_type || "document";
          const topic = parsed.topic;
          if (!topic) return { description: "Compose: no topic", error: "No topic provided" };
          
          console.log(`   📝 Generating ${contentType}: "${topic.substring(0, 50)}..."`);
          
          // Generate content using Gemini
          const generatedContent = await this.generateContent(contentType, topic);
          if (!generatedContent) {
            return { description: "Compose: generation failed", error: "Failed to generate content" };
          }
          
          // Type the generated content
          await this.desktop.typeText(generatedContent);
          return {
            description: `Composed ${contentType}: "${topic.substring(0, 30)}..." (${generatedContent.length} chars)`,
          };
        }
        case "key": {
          if (!text) return { description: "Key: empty", error: "No key" };
          await this.desktop.keyPress(normalizeKeyCombo(text));
          return { description: `Key press: ${text}` };
        }

        case "scroll": {
          const [x, y] = coordinate
            ? this.scale(coordinate)
            : [
                Math.round(this.screenWidth / 2),
                Math.round(this.screenHeight / 2),
              ];
          const dir = parsed.scroll_direction || "down";
          const amount = parsed.scroll_amount || 5;
          const delta = dir === "up" || dir === "left" ? -amount : amount;
          await this.desktop.mouseScroll(x, y, delta);
          return { description: `Scroll ${dir} by ${amount} at (${x}, ${y})` };
        }
        case "left_click_drag": {
          if (!start_coordinate || !coordinate) {
            return {
              description: "Drag: missing coords",
              error: "Need start_coordinate and coordinate",
            };
          }
          const [sx, sy] = this.scale(start_coordinate);
          const [ex, ey] = this.scale(coordinate);
          await this.desktop.mouseDrag(sx, sy, ex, ey);
          return { description: `Drag (${sx},${sy}) → (${ex},${ey})` };
        }
        default:
          return {
            description: `Unknown: ${action}`,
            error: `Unsupported action: ${action}`,
          };
      }
    } catch (err) {
      return { description: `${action} failed: ${err}`, error: String(err) };
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private scale(coords: [number, number]): [number, number] {
    return [
      Math.min(
        Math.round(
          Math.min(Math.max(coords[0], 0), this.llmWidth - 1) *
            this.scaleFactor,
        ),
        this.screenWidth - 1,
      ),
      Math.min(
        Math.round(
          Math.min(Math.max(coords[1], 0), this.llmHeight - 1) *
            this.scaleFactor,
        ),
        this.screenHeight - 1,
      ),
    ];
  }

  private async getA11yContext(): Promise<string> {
    try {
      const context = await this.a11y.getScreenContext();
      return `ACCESSIBILITY:\n${context}`;
    } catch {
      return "ACCESSIBILITY: (unavailable)";
    }
  }

  /**
   * Generate content using Gemini text generation.
   */
  private async generateContent(contentType: string, topic: string): Promise<string | null> {
    const prompts: Record<string, string> = {
      essay: `Write a well-structured essay on the following topic. Include an introduction, body paragraphs with supporting details, and a conclusion. Write at least 300 words.\n\nTopic: ${topic}`,
      letter: `Write a formal letter for the following purpose. Include proper salutation, body, and closing.\n\nPurpose: ${topic}`,
      email: `Write a professional email for the following purpose. Include greeting, body, and signature.\n\nPurpose: ${topic}`,
      code: `Write clean, well-commented code for the following requirement.\n\nRequirement: ${topic}`,
      document: `Write a document for the following purpose.\n\nPurpose: ${topic}`,
    };

    const prompt = prompts[contentType] || prompts.document;

    try {
      const response = await geminiTextCall(
        this.geminiConfig,
        "You are a professional content writer. Generate the requested content directly without any preamble or meta-commentary. Do not use markdown formatting unless specifically writing code.",
        prompt,
        4096
      );

      if (!response) return null;
      
      // Clean up any markdown formatting that might interfere with typing
      return response.replace(/```[a-z]*\n?/g, "").replace(/```/g, "").trim();
    } catch (err) {
      console.error(`   ❌ Content generation failed: ${err}`);
      return null;
    }
  }

  private saveDebug(
    buffer: Buffer,
    dir: string,
    si: number,
    step: number,
    action: string,
  ): void {
    try {
      fs.writeFileSync(
        path.join(dir, `gemini-${si}-${step}-${action}.png`),
        buffer,
      );
    } catch {
      /* non-fatal */
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
