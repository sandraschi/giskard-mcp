"""Generate icons for MCPB and Tauri."""
from PIL import Image, ImageDraw, ImageFont
import os

img = Image.new("RGBA", (256, 256), (9, 9, 11, 255))
draw = ImageDraw.Draw(img)
draw.rounded_rectangle([8, 8, 248, 248], radius=32, fill=(245, 158, 11, 255))

font_path = "C:/Windows/Fonts/consolab.ttf"
try:
    font = ImageFont.truetype(font_path, 128)
except Exception:
    font = ImageFont.load_default()

bbox = draw.textbbox((0, 0), "G", font=font)
tw = bbox[2] - bbox[0]
th = bbox[3] - bbox[1]
draw.text(((256 - tw) / 2, (256 - th) / 2 - 8), "G", fill=(9, 9, 11, 255), font=font)

img.save("assets/icon.png")
print(f"Created assets/icon.png ({os.path.getsize('assets/icon.png')} bytes)")

os.makedirs("native/src-tauri/icons", exist_ok=True)
sizes = [(32, "32x32.png"), (128, "128x128.png"), (256, "128x128@2x.png"), (256, "icon.png")]
for size, name in sizes:
    resized = img.resize((size, size), Image.LANCZOS)
    path = f"native/src-tauri/icons/{name}"
    resized.save(path)
    print(f"Created {path}")

img.save("native/src-tauri/icons/icon.ico", format="ICO", sizes=[(32, 32), (256, 256)])
print("Created native/src-tauri/icons/icon.ico")
