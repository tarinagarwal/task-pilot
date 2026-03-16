#!/bin/bash
# =============================================================================
# TaskPilot - Docker + Terraform Deployment Script
# =============================================================================
# This script automates Cloud deployment with Dockerfile + Terraform only.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated (gcloud auth login)
#   - Docker installed
#   - Terraform installed
#
# Usage:
#   ./deploy.sh                          # Deploy with defaults
#   ./deploy.sh --project my-proj        # Set project
#   ./deploy.sh --project my-proj --tag v1.2.3
# =============================================================================

set -e  # Exit on error

# Default configuration
PROJECT_ID="${GCP_PROJECT_ID:-}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="computer-use-preview"
REPOSITORY="gemini-computer-use"
MEMORY="2Gi"
CPU="2"
TIMEOUT="3600"
MAX_INSTANCES="10"
IMAGE_TAG=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Show help
show_help() {
    echo "Gemini Computer Use - Deployment Script"
    echo ""
    echo "Usage: ./deploy.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --project, -p    GCP Project ID (required if not set in env)"
    echo "  --region, -r     GCP Region (default: us-central1)"
    echo "  --tag, -t        Docker image tag (default: git sha or timestamp)"
    echo "  --memory, -m     Memory allocation (default: 2Gi)"
    echo "  --cpu, -c        CPU allocation (default: 2)"
    echo "  --max-instances  Max Cloud Run instances (default: 10)"
    echo "  --timeout        Timeout in seconds (default: 3600)"
    echo "  --help, -h       Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  GCP_PROJECT_ID   Default project ID"
    echo "  GCP_REGION       Default region"
    echo ""
    echo "Examples:"
    echo "  ./deploy.sh --project my-gcp-project"
    echo "  ./deploy.sh -p my-project -r europe-west1"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --project|-p) PROJECT_ID="$2"; shift 2 ;;
        --region|-r) REGION="$2"; shift 2 ;;
        --tag|-t) IMAGE_TAG="$2"; shift 2 ;;
        --memory|-m) MEMORY="$2"; shift 2 ;;
        --cpu|-c) CPU="$2"; shift 2 ;;
        --max-instances) MAX_INSTANCES="$2"; shift 2 ;;
        --timeout) TIMEOUT="$2"; shift 2 ;;
        --help|-h) show_help; exit 0 ;;
        *) print_error "Unknown option: $1"; show_help; exit 1 ;;
    esac
done

# Validate project ID
if [ -z "$PROJECT_ID" ]; then
    PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
    if [ -z "$PROJECT_ID" ]; then
        print_error "No project ID specified. Use --project or set GCP_PROJECT_ID"
        exit 1
    fi
fi

# Resolve image tag
if [ -z "$IMAGE_TAG" ]; then
    if command -v git &> /dev/null && git rev-parse --is-inside-work-tree &> /dev/null; then
        IMAGE_TAG=$(git rev-parse --short HEAD)
    else
        IMAGE_TAG=$(date +%Y%m%d%H%M%S)
    fi
fi

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${SERVICE_NAME}:${IMAGE_TAG}"

# Print banner
echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║       TASKPILOT - DOCKER + TERRAFORM DEPLOYMENT              ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
print_info "Project:  $PROJECT_ID"
print_info "Region:   $REGION"
print_info "Service:  $SERVICE_NAME"
print_info "Image:    $IMAGE_URI"
print_info "Memory:   $MEMORY"
print_info "CPU:      $CPU"
print_info "MaxInst:  $MAX_INSTANCES"
print_info "Timeout:  $TIMEOUT"
echo ""

# Check tools
if ! command -v gcloud &> /dev/null; then
    print_error "gcloud CLI is not installed. Please install it first."
    exit 1
fi

if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install it first."
    exit 1
fi

if ! command -v terraform &> /dev/null; then
    print_error "Terraform is not installed. Please install it first."
    exit 1
fi

# Check if authenticated
if ! gcloud auth print-identity-token &> /dev/null; then
    print_warning "Not authenticated. Running 'gcloud auth login'..."
    gcloud auth login
fi

# Set the project
print_info "Setting project to $PROJECT_ID..."
gcloud config set project "$PROJECT_ID"

# Configure Docker auth for Artifact Registry
print_info "Configuring Docker auth for Artifact Registry..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# Locate repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Bootstrap APIs + Artifact Registry via Terraform targets
print_info "Bootstrapping APIs and Artifact Registry with Terraform..."
cd "$SCRIPT_DIR/terraform"
terraform init -input=false
terraform apply -auto-approve -input=false \
    -var="project_id=$PROJECT_ID" \
    -var="region=$REGION" \
    -target=google_project_service.run_api \
    -target=google_project_service.artifactregistry_api \
    -target=google_artifact_registry_repository.docker_repo

# Build and push image from Dockerfile
print_info "Building Docker image from computer-use-preview/Dockerfile..."
cd "$SCRIPT_DIR"
docker build -t "$IMAGE_URI" ./computer-use-preview

print_info "Pushing Docker image to Artifact Registry..."
docker push "$IMAGE_URI"

# Full Terraform apply (Cloud Run deployment)
print_info "Applying full Terraform deployment..."
cd "$SCRIPT_DIR/terraform"
terraform apply -auto-approve -input=false \
    -var="project_id=$PROJECT_ID" \
    -var="region=$REGION" \
    -var="cpu=$CPU" \
    -var="memory=$MEMORY" \
    -var="max_instances=$MAX_INSTANCES" \
    -var="timeout=$TIMEOUT" \
    -var="image_tag=$IMAGE_TAG"

# Get the service URL
SERVICE_URL=$(terraform output -raw service_url)
WEBSOCKET_URL="${SERVICE_URL/https:\/\//wss://}"

# Print success message
echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    DEPLOYMENT SUCCESSFUL!                      ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
print_success "Service deployed successfully!"
echo ""
echo "  HTTP URL:      $SERVICE_URL"
echo "  WebSocket URL: $WEBSOCKET_URL"
echo "  Image Tag:     $IMAGE_TAG"
echo ""
print_info "Deployment is fully scripted and Terraform-managed (no GitHub Actions)."
echo ""
