import json
import os
import re
import requests
import sys

DASHBOARD_IDS = [
    1860,  # Node Exporter
    14282, # cAdvisor Exporter
    19062, # NodeJS Applications Dashboard
]
OUTPUT_DIR = "/etc/grafana/provisioning/dashboards"
PROMETHEUS_NAME = "Prometheus"
# cAdvisor Exporter в своей конфигурации требует явно указать имя Prometheus
# ресурса, поэтому просто подставляем его руками

try:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
except Exception as e:
    print(f"[ERROR] Cannot create directory {OUTPUT_DIR}: {e}", file=sys.stderr)
    sys.exit(1)

had_errors = False

for db_id in DASHBOARD_IDS:
    url = f"https://grafana.com/api/dashboards/{db_id}/revisions/latest/download"
    print(f"[INFO] Downloading {db_id}...")

    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()

        raw_text = response.text
        raw_text = re.sub(r'"\${DS_[A-Z_]+}"', f'"{PROMETHEUS_NAME}"', raw_text)
        raw_text = re.sub(r'\${DS_[A-Z_]+}', PROMETHEUS_NAME, raw_text)

        dashboard_data = json.loads(raw_text)

        title = dashboard_data.get("title", f"dashboard_{db_id}").lower().replace(" ", "_")
        filename = os.path.join(OUTPUT_DIR, f"{title}.json")

        with open(filename, "w", encoding="utf-8") as f:
            json.dump(dashboard_data, f, indent=2, ensure_ascii=False)

        print(f"[SUCCESS] Downloaded and patched: {filename}")

    except requests.exceptions.RequestException as e:
        print(f"[ERROR] Failed downloading ID {db_id}: {e}", file=sys.stderr)
        had_errors = True
    except json.JSONDecodeError as e:
        print(f"[ERROR] Failed to parse JSON for ID {db_id}: {e}", file=sys.stderr)
        had_errors = True

if had_errors:
    print("[WARNING] Some dashboards failed to download. Check logs above.", file=sys.stderr)

print("[INFO] Downloading dashboards finished successfully.")
sys.exit(0)
