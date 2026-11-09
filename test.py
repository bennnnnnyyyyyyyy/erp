import socket
import ssl
import urllib.request
import urllib.error
import json

endpoint = "api.anthropic.com"
port = 443

print("=== Starting Claude API Network Diagnostics ===")

# 1. Test DNS Resolution
print("\n[1/3] Testing DNS Resolution...", end="")
try:
    ip_addresses = socket.gethostbyname_ex(endpoint)
    print(" SUCCESS")
    print(f"Resolved IPs: {', '.join(ip_addresses[2])}")
except socket.gaierror as e:
    print(f" FAILED\nDNS Lookup failed: {e}")
    exit(1)

# 2. Test TCP Connection & SSL Handshake
print("\n[2/3] Testing TCP connection and SSL handshake...", end="")
context = ssl.create_default_context()
try:
    with socket.create_connection((endpoint, port), timeout=5) as sock:
        with context.wrap_socket(sock, server_hostname=endpoint) as ssock:
            cipher = ssock.cipher()
            print(" SUCCESS")
            print(f"Connected using {cipher[0]} ({cipher[2]} bits)")
except Exception as e:
    print(f" FAILED\nConnection or SSL handshake failed: {e}")
    print("Check if Deep Packet Inspection (DPI) or an explicit proxy is blocking TLS 1.3.")
    exit(1)

# 3. Test API Payload Handshake
print("\n[3/3] Testing HTTP payload delivery...", end="")
url = f"https://{endpoint}/v1/messages"
req = urllib.request.Request(
    url, 
    data=json.dumps({}).encode('utf-8'), 
    headers={'Content-Type': 'application/json'}, 
    method='POST'
)

try:
    urllib.request.urlopen(req, timeout=5)
except urllib.error.HTTPError as e:
    if e.code == 401:
        print(" SUCCESS")
        print("\n[RESULT] Network route is completely clear! Anthropic returned 401 Unauthorized (expected without an API Key).")
    else:
        print(f" FAILED\nServer returned HTTP Code: {e.code}")
except urllib.error.URLError as e:
    print(f" FAILED\nNetwork error: {e.reason}")
