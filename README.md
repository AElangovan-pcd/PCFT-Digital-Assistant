# PCFT Union Digital Assistant - Deployment Guide

This guide provides instructions for deploying the PCFT Contract Assistant application to various web hosting environments.

## Option 1: GitHub Pages (Recommended)

GitHub Pages is the easiest way to host this assistant for free. Since the application requires an API Key, we use GitHub Actions to securely inject the key during the build process.

### 1. Setup GitHub Secrets
1.  Go to your GitHub repository.
2.  Navigate to **Settings** > **Secrets and variables** > **Actions**.
3.  Click **New repository secret**.
4.  Name: `API_KEY`
5.  Value: (Your Google Gemini API Key)
6.  Click **Add secret**.

### 2. Configure GitHub Pages
1.  Go to **Settings** > **Pages**.
2.  Under **Build and deployment** > **Source**, select **GitHub Actions**.

### 3. Deployment
The included `.github/workflows/deploy.yml` file will automatically build and deploy your site whenever you push to the `main` branch. 

**Note on API Security:** Because this is a static site, the API key will be present in the bundled JavaScript code. **You MUST restrict your API key** in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) to only allow requests from your specific GitHub Pages URL (e.g., `https://yourusername.github.io/*`).

---

## Option 2: AWS EC2 (Ubuntu/Nginx)

For a more robust production environment.

### 1. Prepare Your AWS EC2 Instance
1.  **Launch Instance**: Select an `t3.micro` or `t3.small` instance (Ubuntu 22.04 LTS).
2.  **Security Group**: Ensure ports `22` (SSH), `80` (HTTP), and `443` (HTTPS) are open.

### 2. Server Setup
Connect via SSH:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install nginx git -y
```

### 3. Application Build & Deployment
1.  **Install Node.js**:
    ```bash
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
    ```
2.  **Clone & Build**:
    ```bash
    cd /var/www
    sudo git clone https://github.com/your-username/pcft-assistant.git
    cd pcft-assistant
    export API_KEY=your_key_here
    npm install
    npm run build
    ```

### 4. Configure Nginx
Create `/etc/nginx/sites-available/pcft-assistant`:
```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/pcft-assistant/dist;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
}
```

---

## Troubleshooting

*   **Microphone Access**: Browsers **block** microphone access (Live Mode) on non-HTTPS connections. You must use SSL (Certbot/LetsEncrypt) for full functionality.
*   **404 on Refresh**: Ensure your hosting provider is configured to redirect all traffic to `index.html` (Single Page Application routing).
