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

# Optional: GitHub configuration for Cloud Build triggers
variable "github_owner" {
  description = "GitHub repository owner"
  type        = string
  default     = ""
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
  default     = ""
}
