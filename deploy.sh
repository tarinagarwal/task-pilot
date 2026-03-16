#!/bin/bash
# =============================================================================
# Gemini Computer Use - One-Click Deployment Script
# =============================================================================
# This script automates the deployment of computer-use-preview to Google Cloud Run
#
# Prerequisites:
#   - gcloud CLI installed and authenticated (gcloud auth login)
#   - Docker installed (for local builds)
#
# Usage:
#   ./deploy.sh                    # Deploy with default settings
#   ./deploy.sh --project my-proj  # Deploy to specific project
#   ./deploy.sh --help             # Show help
# =============================================================================

set -e  # Exit on error

# Default configuration
PROJECT_ID="${GCP_PROJECT_ID:-}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="computer-use-preview"
MEMORY="2Gi"
CPU="2"
TIMEOUT="3600"

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
    echo "  --memory, -m     Memory allocation (default: 2Gi)"
    echo "  --cpu, -c        CPU allocation (default: 2)"
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
        --memory|-m) MEMORY="$2"; shift 2 ;;
        --cpu|-c) CPU="$2"; shift 2 ;;
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

# Print banner
echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║       GEMINI COMPUTER USE - AUTOMATED DEPLOYMENT              ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
print_info "Project:  $PROJECT_ID"
print_info "Region:   $REGION"
print_info "Service:  $SERVICE_NAME"
print_info "Memory:   $MEMORY"
print_info "CPU:      $CPU"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    print_error "gcloud CLI is not installed. Please install it first."
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

# Enable required APIs
print_info "Enabling required APIs..."
gcloud services enable run.googleapis.com --quiet
gcloud services enable cloudbuild.googleapis.com --quiet
gcloud services enable artifactregistry.googleapis.com --quiet

# Navigate to computer-use-preview directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/computer-use-preview"

# Deploy to Cloud Run from source
print_info "Deploying to Cloud Run (this may take a few minutes)..."
echo ""

gcloud run deploy "$SERVICE_NAME" \
    --source . \
    --region "$REGION" \
    --memory "$MEMORY" \
    --cpu "$CPU" \
    --timeout "$TIMEOUT" \
    --allow-unauthenticated \
    --session-affinity \
    --set-env-vars "USE_VERTEXAI=true,VERTEXAI_PROJECT=$PROJECT_ID,VERTEXAI_LOCATION=global,PLAYWRIGHT_HEADLESS=true" \
    --quiet

# Get the service URL
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format 'value(status.url)')
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
echo ""
print_info "Update your frontend to use the WebSocket URL above"
echo ""
