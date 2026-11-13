"""Draws the toolbar/store icons: two overlapping speech bubbles on teal."""
from PIL import Image, ImageDraw

def icon(size: int) -> Image.Image:
    s = 4  # supersample
    n = size * s
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * 0.22), fill=(15, 118, 110, 255))
    def bubble(x0, y0, x1, y1, tail_left, fill):
        d.rounded_rectangle([x0, y0, x1, y1], radius=int(n * 0.09), fill=fill)
        ty = y1 - 1
        if tail_left:
            d.polygon([(x0 + n*0.08, ty), (x0 + n*0.22, ty), (x0 + n*0.06, ty + n*0.12)], fill=fill)
        else:
            d.polygon([(x1 - n*0.22, ty), (x1 - n*0.08, ty), (x1 - n*0.06, ty + n*0.12)], fill=fill)
    bubble(n*0.14, n*0.16, n*0.62, n*0.50, True, (255, 255, 255, 255))
    bubble(n*0.38, n*0.40, n*0.86, n*0.74, False, (153, 246, 228, 255))
    # "lines of text" in the front bubble
    for i, w in enumerate((0.34, 0.24)):
        y = n * (0.52 + i * 0.09)
        d.rounded_rectangle([n*0.46, y, n*(0.46 + w), y + n*0.045], radius=int(n*0.02), fill=(15, 118, 110, 255))
    return im.resize((size, size), Image.LANCZOS)

for sz in (16, 32, 48, 128):
    icon(sz).save(f"static/icons/{sz}.png")
