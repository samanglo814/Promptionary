# Deploying to Vultr

One Vultr server runs everything: the website, the game server, and HTTPS (so phone mics work).
Players scan the QR code from anywhere, with no tunnel and no laptop needed.

## 1. Create the server

In the Vultr dashboard, **Deploy New Server**:

- **Type:** Cloud Compute, Shared CPU
- **Location:** the closest to the venue
- **Image:** Ubuntu 24.04
- **Plan:** 2 GB memory is comfortable. 1 GB works too (the script adds swap), but building is slower.

Deploy it and wait until it says **Running**.

## 2. Run the setup script

Open the server's **View Console** in Vultr (or `ssh root@<server IP>` with the password from the dashboard) and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/samanglo814/Reverse-Charades/main/deploy/vultr-setup.sh | bash
```

It takes about 5 minutes. At the end it prints the address, like `https://203.0.113.7.sslip.io/host`.
[sslip.io](https://sslip.io) is a free address that points at the server's IP, so no domain is needed.
With your own domain, point it (and `api.` in front of it) at the server's IP first, then run the script with `DOMAIN=yourdomain.com` before `bash`.

## 3. Add the AI

Without keys the game runs the fake AI. Edit the settings on the server:

```bash
nano /opt/promptionary/server/.env
```

Pick one:

- **Free keys:** `GEMINI_API_KEY=key1,key2,...`
- **Vertex AI** (billed to a Google Cloud project, where free-trial credits apply):
  1. In the Google Cloud console, open **IAM & Admin → Service Accounts → Create service account**, give it the **Vertex AI User** role, then **Keys → Add key → JSON**. A `.json` file downloads.
  2. Copy it to the server from your computer: `scp ~/Downloads/<the-file>.json root@<server IP>:/opt/promptionary/server/gcp-key.json`
  3. In `.env`, set `VERTEX_PROJECT=<project id>` and `GEMINI_TEXT_MODEL=<model name>`.
  4. Run the setup script again (it picks up the key file).

Save, then restart the game server:

```bash
systemctl restart promptionary-server
```

## Updating

Run the same setup command again: it pulls the latest `main`, rebuilds, and restarts. Your `.env` stays.

## When something's wrong

```bash
journalctl -u promptionary-server -f   # game server logs (AI errors show up here)
journalctl -u promptionary-web -f      # website logs
journalctl -u caddy -f                 # HTTPS certificate problems
systemctl status promptionary-server promptionary-web caddy
```
