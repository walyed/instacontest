"""
Instagram Profile Picture Proxy Server
Run locally: python fetch_instagram.py
This runs a small API on your computer (residential IP) that
the Vercel-hosted app can call to fetch Instagram profile pics.

Setup:
1. pip install requests beautifulsoup4 flask flask-cors
2. python fetch_instagram.py
3. Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
4. In another terminal: cloudflared tunnel --url http://localhost:5001
5. Copy the https://...trycloudflare.com URL
6. In Vercel: Settings > Environment Variables > add IG_PROXY_URL = <that URL>
7. Redeploy
"""
import sys
import requests
from bs4 import BeautifulSoup
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

API_SECRET = "instacontest-proxy-2026"


def fetch_profile_pic(username: str) -> dict:
    url = f"https://www.instagram.com/{username}/"
    headers = {"User-Agent": "Mozilla/5.0"}

    try:
        resp = requests.get(url, headers=headers, timeout=15)
    except Exception as e:
        return {"error": str(e), "image": None}

    if resp.status_code != 200:
        return {"error": f"HTTP {resp.status_code}", "image": None}

    soup = BeautifulSoup(resp.text, "html.parser")
    og = soup.find("meta", property="og:image")

    if og and og.get("content"):
        img_url = og["content"]
        # Filter out Instagram's generic camera icon
        if "/rsrc.php/" in img_url or "static.cdninstagram.com" in img_url:
            return {"error": "Got Instagram logo, not real profile pic", "image": None}
        return {"error": None, "image": img_url}

    return {"error": "No og:image found", "image": None}


@app.route("/api/instagram", methods=["GET"])
def instagram_endpoint():
    # Simple auth to prevent abuse
    secret = request.headers.get("x-proxy-secret", "")
    if secret != API_SECRET:
        return jsonify({"error": "Unauthorized"}), 401

    username = request.args.get("username", "").strip().lstrip("@")
    if not username or len(username) > 30:
        return jsonify({"error": "Invalid username"}), 400

    result = fetch_profile_pic(username)
    return jsonify(result)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] != "--serve":
        # CLI mode: python fetch_instagram.py <username>
        username = sys.argv[1].lstrip("@")
        print(f"Fetching profile picture for: {username}\n")
        result = fetch_profile_pic(username)
        if result["image"]:
            print(f"✓ Success! Profile picture URL:\n{result['image']}")
        else:
            print(f"✗ Failed: {result['error']}")
    else:
        # Server mode: python fetch_instagram.py --serve  (or just python fetch_instagram.py)
        print("=" * 50)
        print("Instagram Proxy Server")
        print("=" * 50)
        print(f"Running on http://localhost:5001")
        print(f"Secret: {API_SECRET}")
        print()
        print("Next step: In another terminal, run:")
        print("  cloudflared tunnel --url http://localhost:5001")
        print()
        print("Then add the tunnel URL to Vercel env as IG_PROXY_URL")
        print("=" * 50)
        app.run(host="0.0.0.0", port=5001)
