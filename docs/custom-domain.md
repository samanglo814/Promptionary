# Playing at your own domain

`./dev-tunnel.sh promptionary.design` runs the game from your laptop at **https://promptionary.design**
(the game server at `api.promptionary.design`), the same address every time. It uses a free named
Cloudflare tunnel. One-time setup:

## 1. Put the domain on Cloudflare (free)

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up), then **Add a domain** → `promptionary.design` → **Free** plan.
2. Cloudflare shows two **nameservers** (like `ada.ns.cloudflare.com`).
3. In Porkbun: **Domain Management** → your domain → **Authoritative Nameservers** → **Edit**. Replace what's there with Cloudflare's two, and save.
4. Wait until Cloudflare says the domain is **Active** (minutes, sometimes a few hours; Cloudflare emails you).

## 2. Create the tunnel (on your laptop)

```bash
cloudflared tunnel login                     # browser opens: pick promptionary.design
cloudflared tunnel create promptionary
cloudflared tunnel route dns promptionary promptionary.design
cloudflared tunnel route dns promptionary api.promptionary.design
```

## 3. Play

```bash
./dev-tunnel.sh promptionary.design
```

Open **https://promptionary.design/host**. The QR code points at your domain.

With Auth0 sign-in on, also add `https://promptionary.design/auth/callback` to the app's
**Allowed Callback URLs** and `https://promptionary.design` to **Allowed Logout URLs**.
