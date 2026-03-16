# Output values from Terraform deployment

output "service_url" {
  description = "URL of the deployed Cloud Run service"
  value       = google_cloud_run_v2_service.computer_use_preview.uri
}

output "service_name" {
  description = "Name of the Cloud Run service"
  value       = google_cloud_run_v2_service.computer_use_preview.name
}

output "websocket_url" {
  description = "WebSocket URL for frontend connection (wss://)"
  value       = replace(google_cloud_run_v2_service.computer_use_preview.uri, "https://", "wss://")
}

output "region" {
  description = "Deployment region"
  value       = var.region
}

output "project_id" {
  description = "GCP Project ID"
  value       = var.project_id
}

output "docker_repository" {
  description = "Artifact Registry repository URL"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/gemini-computer-use"
}
