#!/bin/bash
# ===========================================
# Generate Self-Signed SSL Certificate
# For development/testing only
# ===========================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SSL_DIR="$SCRIPT_DIR/../ssl"
DOMAIN="${1:-vstats.local}"

echo "======================================"
echo "VStats SSL Certificate Generator"
echo "======================================"
echo "Domain: $DOMAIN"
echo "Output: $SSL_DIR"
echo ""

# 创建 SSL 目录
mkdir -p "$SSL_DIR"

# 检查是否已存在证书
if [ -f "$SSL_DIR/cert.pem" ] && [ -f "$SSL_DIR/key.pem" ]; then
    read -p "SSL certificates already exist. Overwrite? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
fi

echo ">> Generating self-signed certificate..."

# 生成私钥和证书
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$SSL_DIR/key.pem" \
    -out "$SSL_DIR/cert.pem" \
    -subj "/CN=$DOMAIN/O=VStats/C=US" \
    -addext "subjectAltName=DNS:$DOMAIN,DNS:localhost,IP:127.0.0.1"

echo ""
echo "======================================"
echo "✅ SSL Certificate Generated"
echo "======================================"
echo "Certificate: $SSL_DIR/cert.pem"
echo "Private Key: $SSL_DIR/key.pem"
echo ""
echo "⚠️  This is a self-signed certificate for development only!"
echo "   For production, use Let's Encrypt or Cloudflare Origin Certificate."
echo ""
echo "To use Cloudflare Origin Certificate:"
echo "1. Go to Cloudflare Dashboard > SSL/TLS > Origin Server"
echo "2. Create Certificate"
echo "3. Save the certificate to: $SSL_DIR/cert.pem"
echo "4. Save the private key to: $SSL_DIR/key.pem"
