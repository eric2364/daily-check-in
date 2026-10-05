"""Generate opaque app icons with Pillow: python3 scripts/generate-icons.py."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / 'public' / 'icons'
OUT.mkdir(parents=True, exist_ok=True)
NAVY = '#153b38'
MINT = '#d2eee1'

def icon(size, maskable=False):
    # Draw large and downsample for crisp, antialiased edges. The calendar sits
    # inside the central 80% safe area, including its binding rings.
    im = Image.new('RGB', (1024, 1024), NAVY)
    draw = ImageDraw.Draw(im)
    draw.rounded_rectangle((232, 256, 792, 824), radius=96, fill=MINT)
    draw.line((232, 418, 792, 418), fill=NAVY, width=36)
    for x in (364, 660):
        draw.line((x, 218, x, 344), fill=MINT, width=56)
        draw.ellipse((x-28, 190, x+28, 246), fill=MINT)
        draw.ellipse((x-28, 316, x+28, 372), fill=MINT)
    points = ((360, 606), (456, 702), (668, 478))
    draw.line(points, fill=NAVY, width=56, joint='curve')
    for x, y in points:
        draw.ellipse((x-28, y-28, x+28, y+28), fill=NAVY)
    return im.resize((size, size), Image.Resampling.LANCZOS)

for name, size in [('icon-192.png', 192), ('icon-512.png', 512),
                   ('icon-maskable-512.png', 512), ('apple-touch-icon.png', 180)]:
    path = OUT / name
    icon(size, 'maskable' in name).save(path)
    print(f'{path.name}: {Image.open(path).size}')
