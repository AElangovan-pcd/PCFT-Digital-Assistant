# PCFT Union Digital Assistant - Deployment Guide

This guide provides instructions for deploying the PCFT Contract Assistant application to a web server, specifically focusing on AWS EC2 instances.

## Prerequisites

*   An AWS account.
*   An EC2 instance (Ubuntu 22.04 LTS recommended).
*   Domain name (optional, but recommended for SSL).
*   Gemini API Key.

## 1. Prepare Your AWS EC2 Instance

1.  **Launch Instance**: Select an `t3.micro` or `t3.small` instance.
2.  **Security Group**: Ensure the following ports are open:
    *   `22` (SSH)
    *   `80` (HTTP)
    *   `443` (HTTPS)
3.  **Elastic IP**: Assign an Elastic IP to your instance to ensure the public IP remains static.

## 2. Server Setup

Connect to your instance via SSH:
```bash
ssh -i your-key.pem ubuntu@your-instance-ip
```

Update the system and install Nginx:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install nginx git -y
```

## 3. Application Build & Deployment

Since this application uses React with TSX and ESM modules, it is best served as a static bundle.

### Option A: Manual Static Deployment (Simplest)
1.  **Build locally**: Run your local build command (e.g., `npm run build` if using Vite/Webpack).
2.  **Transfer files**: Use SCP or SFTP to move the `dist` or `build` folder content to the server:
    ```bash
    scp -i your-key.pem -r ./dist/* ubuntu@your-instance-ip:/var/www/html/
    ```

### Option B: On-Server Build (Recommended for CI/CD)
1.  **Install Node.js**:
    ```bash
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
    ```
2.  **Clone Repository**:
    ```bash
    cd /var/www
    sudo git clone https://github.com/your-username/pcft-assistant.git
    cd pcft-assistant
    ```
3.  **Install & Build**:
    ```bash
    npm install
    npm run build
    ```
4.  **Configure Permissions**:
    ```bash
    sudo chown -R www-data:www-data /var/www/pcft-assistant/dist
    ```

## 4. Configure Nginx

Create a new Nginx configuration file:
```bash
sudo nano /etc/nginx/sites-available/pcft-assistant
```

Add the following configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com; # Or your IP address

    root /var/www/pcft-assistant/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }
}
```

Enable the site and restart Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/pcft-assistant /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## 5. Environment Variables & API Key

The application requires `process.env.API_KEY`. 
*   **Static Hosting**: Most modern build tools (like Vite) inject environment variables at build time. Ensure you create a `.env` file on your build server or local machine before running the build:
    ```text
    API_KEY=your_gemini_api_key_here
    ```
*   **Security Note**: For public web deployments, ensure you use API key restrictions (HTTP Referrer restrictions) in the Google Cloud Console to prevent unauthorized use of your key.

## 6. SSL Configuration (HTTPS)

It is highly recommended to use HTTPS, especially for microphone features (Live Mode).
```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d your-domain.com
```

## Troubleshooting

*   **Microphone Access**: Browsers block microphone access on non-HTTPS (unsecured) connections. Ensure SSL is properly configured.
*   **404 on Refresh**: If you use React Router, ensure the `try_files` directive in Nginx is pointing to `/index.html`.
*   **Permission Denied**: Check Nginx logs with `sudo tail -f /var/log/nginx/error.log`.