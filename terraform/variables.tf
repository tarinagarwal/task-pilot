# Input variables for Gemini Computer Use Terraform deployment

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP region for Cloud Run deployment"
  type        = string
  default     = "us-central1"
}

variable "cpu" {
  description = "CPU allocation for Cloud Run service"
  type        = string
  default     = "2"
}

variable "memory" {
  description = "Memory allocation for Cloud Run service"
  type        = string
  default     = "2Gi"
}

variable "max_instances" {
  description = "Maximum number of Cloud Run instances"
  type        = number
  default     = 10
}

variable "timeout" {
  description = "Request timeout in seconds"
  type        = number
  default     = 3600
}

variable "image_tag" {
  description = "Docker image tag to deploy to Cloud Run"
  type        = string
  default     = "latest"
}
