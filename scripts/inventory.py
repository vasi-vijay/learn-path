import re
import json

with open("public/vendor/bundle.js", "r", encoding="utf-8") as f:
    content = f.read()

# Match all Drive file links:
pattern = r"https://drive\.google\.com/file/d/([a-zA-Z0-9_-]+)"
matches = re.findall(pattern, content)
unique_ids = list(dict.fromkeys(matches))

print(f"Total unique Drive file IDs found: {len(unique_ids)}")

inventory = []
for fid in unique_ids:
    idx = content.find(fid)
    snippet = content[max(0, idx - 400):min(len(content), idx + 400)]
    
    # Try to find title/name
    title_match = re.search(r"(?:title|name):[`'\"]([^`'\"]+)[`'\"]", snippet)
    cat_match = re.search(r"category:[`'\"]([^`'\"]+)[`'\"]", snippet)
    internal_id = re.search(r"id:[`'\"]([^`'\"]+)[`'\"]", snippet)
    
    title = title_match.group(1) if title_match else "Unknown Document"
    cat = cat_match.group(1) if cat_match else "General"
    iid = internal_id.group(1) if internal_id else fid
    
    inventory.append({
        "drive_file_id": fid,
        "title": title,
        "category": cat,
        "internal_id": iid,
        "source": "CS Notes / Preparation" if "Notes" in snippet or "notes" in snippet else "Resume Templates",
        "current_url": f"https://drive.google.com/file/d/{fid}/view?usp=drive_link",
        "preview_url": f"https://drive.google.com/file/d/{fid}/preview"
    })

with open("scripts/inventory.json", "w", encoding="utf-8") as out:
    json.dump(inventory, out, indent=2)

print(f"Inventory saved with {len(inventory)} items.")
for i, item in enumerate(inventory):
    print(f"{i+1}. [{item['category']}] {item['title']} (Drive ID: {item['drive_file_id']})")
