"""
Instagram Profile Picture Fetcher
Run locally: python fetch_instagram.py <username>
Works from residential IPs (home network).
"""
import sys
import requests
from bs4 import BeautifulSoup

def fetch_profile_pic(username: str) -> str | None:
    url = f"https://www.instagram.com/{username}/"
    headers = {"User-Agent": "Mozilla/5.0"}
    
    resp = requests.get(url, headers=headers, timeout=15)
    print(f"Status: {resp.status_code}")
    print(f"HTML length: {len(resp.text)}")
    print(f"Login wall: {'/accounts/login' in resp.text}")
    
    if resp.status_code != 200:
        print(f"Error: got status {resp.status_code}")
        return None
    
    soup = BeautifulSoup(resp.text, "html.parser")
    og = soup.find("meta", property="og:image")
    
    if og and og.get("content"):
        img_url = og["content"]
        print(f"\nog:image found:\n{img_url}")
        return img_url
    
    print("\nNo og:image found in the page.")
    return None

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python fetch_instagram.py <username>")
        sys.exit(1)
    
    username = sys.argv[1].lstrip("@")
    print(f"Fetching profile picture for: {username}\n")
    result = fetch_profile_pic(username)
    
    if result:
        print(f"\n✓ Success! Profile picture URL:\n{result}")
    else:
        print("\n✗ Failed to fetch profile picture")
