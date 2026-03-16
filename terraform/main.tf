# Terraform configuration for Gemini Computer Use - Cloud Run Deployment
# This IaC automates the deployment of the computer-use-preview service

terraform {
  required_version = ">= 1.0.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

# Configure the Google Cloud provider
provider "google" {
  project = var.project_id
  region  = var.region
}

# Enable required APIs
resource "google_project_service" "run_api" {
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "cloudbuild_api" {
  service            = "cloudbuild.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "artifactregistry_api" {
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

# Artifact Registry repository for Docker images
resource "google_artifact_registry_repository" "docker_repo" {
  location      = var.region
  repository_id = "gemini-computer-use"
  description   = "Docker repository for Gemini Computer Use images"
  format        = "DOCKER"

  depends_on = [google_project_service.artifactregistry_api]
}

# Cloud Run service for computer-use-preview (Browser automation)
resource "google_cloud_run_v2_service" "computer_use_preview" {
  name     = "computer-use-preview"
  location = var.region

  template {
    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/gemini-computer-use/computer-use-preview:latest"

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
      }

      # Environment variables
      env {
        name  = "USE_VERTEXAI"
        value = "true"
      }
      env {
        name  = "VERTEXAI_PROJECT"
        value = var.project_id
      }
      env {
        name  = "VERTEXAI_LOCATION"
        value = "global"
      }
      env {
        name  = "PLAYWRIGHT_HEADLESS"
        value = "true"
      }

      ports {
        container_port = 8080
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }

    timeout = "${var.timeout}s"

    # Session affinity for WebSocket connections
    session_affinity = true
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [
    google_project_service.run_api,
    google_artifact_registry_repository.docker_repo
  ]
}

# Allow unauthenticated access (for demo/hackathon purposes)
resource "google_cloud_run_v2_service_iam_member" "public_access" {
  location = google_cloud_run_v2_service.computer_use_preview.location
  name     = google_cloud_run_v2_service.computer_use_preview.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Cloud Build trigger for automatic deployments (optional - requires GitHub connection)
# Uncomment if you want to set up automatic deployments on git push
# resource "google_cloudbuild_trigger" "deploy_trigger" {
#   name     = "deploy-computer-use-preview"
#   location = var.region
#
#   github {
#     owner = var.github_owner
#     name  = var.github_repo
#     push {
#       branch = "^main$"
#     }
#   }
#
#   included_files = ["computer-use-preview/**"]
#
#   build {
#     step {
#       name = "gcr.io/cloud-builders/docker"
#       args = ["build", "-t", "${var.region}-docker.pkg.dev/${var.project_id}/gemini-computer-use/computer-use-preview:$COMMIT_SHA", "./computer-use-preview"]
#     }
#     step {
#       name = "gcr.io/cloud-builders/docker"
#       args = ["push", "${var.region}-docker.pkg.dev/${var.project_id}/gemini-computer-use/computer-use-preview:$COMMIT_SHA"]
#     }
#     step {
#       name = "gcr.io/cloud-builders/gcloud"
#       args = ["run", "deploy", "computer-use-preview", "--image", "${var.region}-docker.pkg.dev/${var.project_id}/gemini-computer-use/computer-use-preview:$COMMIT_SHA", "--region", var.region]
#     }
#   }
# }
