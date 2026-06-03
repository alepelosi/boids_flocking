from __future__ import annotations

import argparse
import csv
import html
import math
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


DEFAULT_WEIGHTS = [
    "cohesion",
    "alignment",
    "separation",
    "targetWeight",
    "avoidance",
    "leaderFollowWeight",
]

METHOD_COLORS = {
    "GA": "#0f766e",
    "CMA-ES": "#b45309",
}

FONT_PATH = Path("/System/Library/Fonts/Supplemental/Arial.ttf")
BOLD_FONT_PATH = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Plot optimizer strategy-space PCA from Boids optimizer history CSV."
    )
    parser.add_argument("history_csv", type=Path)
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("strategy_space_plots"),
    )
    parser.add_argument(
        "--weights",
        help="Comma-separated weight columns. Defaults to all available optimized weights.",
    )
    parser.add_argument(
        "--max-points",
        type=int,
        default=4000,
        help="Maximum number of points drawn per dense scatter plot.",
    )
    return parser.parse_args()


def csv_reader(handle):
    sample = handle.read(4096)
    handle.seek(0)
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        first_line = sample.splitlines()[0] if sample else ""
        delimiter = ";" if first_line.count(";") > first_line.count(",") else ","
        return csv.DictReader(handle, delimiter=delimiter)
    return csv.DictReader(handle, dialect=dialect)


def to_float(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def load_rows(path: Path) -> tuple[list[dict[str, str]], list[str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv_reader(handle)
        if not reader.fieldnames:
            raise ValueError(f"{path} has no CSV header.")
        rows = list(reader)
        return rows, list(reader.fieldnames)


def choose_weights(fieldnames: list[str], requested: str | None, rows: list[dict[str, str]]) -> list[str]:
    if requested:
        weights = [entry.strip() for entry in requested.split(",") if entry.strip()]
    else:
        weights = [name for name in DEFAULT_WEIGHTS if name in fieldnames]
    missing = [name for name in weights if name not in fieldnames]
    if missing:
        raise ValueError("Missing weight column(s): " + ", ".join(missing))
    usable = []
    for name in weights:
        if any(to_float(row.get(name)) is not None for row in rows):
            usable.append(name)
    if len(usable) < 2:
        raise ValueError("At least two numeric weight columns are needed for PCA.")
    return usable


def clean_rows(rows: list[dict[str, str]], weights: list[str]) -> list[dict[str, object]]:
    cleaned = []
    for index, row in enumerate(rows, start=1):
        values = [to_float(row.get(weight)) for weight in weights]
        fitness = to_float(row.get("fitness"))
        if fitness is None or any(value is None for value in values):
            continue
        cleaned.append({
            "row": index,
            "method": row.get("method", ""),
            "experimentGroup": row.get("experimentGroup", ""),
            "configName": row.get("configName", ""),
            "optimizerRun": row.get("optimizerRun", ""),
            "optimizerSeed": row.get("optimizerSeed", ""),
            "generation": int(to_float(row.get("generation")) or 0),
            "individual": row.get("individual", ""),
            "rank": int(to_float(row.get("rank")) or 0),
            "evaluation": int(to_float(row.get("evaluation")) or 0),
            "fitness": fitness,
            "targetScore": to_float(row.get("targetScore")),
            "formationScore": to_float(row.get("formationScore")),
            "constraintScore": to_float(row.get("constraintScore")),
            "weights": values,
        })
    if len(cleaned) < 3:
        raise ValueError("Not enough complete optimizer-history rows for PCA.")
    return cleaned


def compute_pca(data: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    mean = data.mean(axis=0)
    std = data.std(axis=0)
    std[std == 0] = 1.0
    standardized = (data - mean) / std
    centered = standardized - standardized.mean(axis=0)
    _, singular_values, vt = np.linalg.svd(centered, full_matrices=False)
    variances = singular_values ** 2 / max(1, len(data) - 1)
    total = variances.sum()
    explained = variances / total if total > 0 else np.zeros_like(variances)
    scores = centered @ vt[:2].T
    return scores, vt, explained, mean, std


def sampled_indices(count: int, max_points: int) -> list[int]:
    if count <= max_points:
        return list(range(count))
    return sorted(set(np.linspace(0, count - 1, max_points, dtype=int).tolist()))


def bounds(values: np.ndarray) -> tuple[float, float]:
    low = float(np.min(values))
    high = float(np.max(values))
    if low == high:
        padding = abs(low) * 0.1 or 1.0
        return low - padding, high + padding
    padding = (high - low) * 0.08
    return low - padding, high + padding


def scale(value: float, low: float, high: float, start: float, end: float) -> float:
    if high == low:
        return (start + end) / 2
    return start + (value - low) / (high - low) * (end - start)


def lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def hex_to_rgb(color: str) -> tuple[int, int, int]:
    color = color.lstrip("#")
    return int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16)


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#" + "".join(f"{channel:02x}" for channel in rgb)


def blend(c1: str, c2: str, t: float) -> str:
    r1, g1, b1 = hex_to_rgb(c1)
    r2, g2, b2 = hex_to_rgb(c2)
    return rgb_to_hex((lerp(r1, r2, t), lerp(g1, g2, t), lerp(b1, b2, t)))


def fitness_color(value: float, low: float, high: float) -> str:
    if high == low:
        t = 0.5
    else:
        t = max(0.0, min(1.0, (value - low) / (high - low)))
    anchors = ["#313695", "#4575b4", "#74add1", "#fdae61", "#d73027"]
    position = t * (len(anchors) - 1)
    index = min(len(anchors) - 2, int(position))
    return blend(anchors[index], anchors[index + 1], position - index)


def text(x: float, y: float, value: str, size: int = 12, anchor: str = "start") -> str:
    return (
        f'<text x="{x:.1f}" y="{y:.1f}" font-family="Arial, sans-serif" '
        f'font-size="{size}" text-anchor="{anchor}" fill="#222">{html.escape(value)}</text>'
    )


def svg_page(width: int, height: int, content: list[str]) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">\n'
        '<rect width="100%" height="100%" fill="#ffffff"/>\n'
        + "\n".join(content)
        + "\n</svg>\n"
    )


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    path = BOLD_FONT_PATH if bold and BOLD_FONT_PATH.exists() else FONT_PATH
    try:
        return ImageFont.truetype(str(path), size)
    except OSError:
        return ImageFont.load_default()


def png_canvas(width: int, height: int) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGB", (width, height), "white")
    return image, ImageDraw.Draw(image)


def png_text(
    draw: ImageDraw.ImageDraw,
    x: float,
    y: float,
    value: str,
    size: int = 12,
    anchor: str = "start",
    fill: str = "#222222",
    bold: bool = False,
) -> None:
    pil_anchor = "lm"
    if anchor == "middle":
        pil_anchor = "mm"
    elif anchor == "end":
        pil_anchor = "rm"
    draw.text((x, y), value, font=font(size, bold), fill=fill, anchor=pil_anchor)


def png_rotated_text(
    image: Image.Image,
    x: float,
    y: float,
    value: str,
    size: int,
    angle: float,
    fill: str = "#222222",
) -> None:
    text_font = font(size)
    box = text_font.getbbox(value)
    width = max(1, box[2] - box[0] + 8)
    height = max(1, box[3] - box[1] + 8)
    layer = Image.new("RGBA", (width, height), (255, 255, 255, 0))
    layer_draw = ImageDraw.Draw(layer)
    layer_draw.text((4, 4), value, font=text_font, fill=fill)
    rotated = layer.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    image.paste(rotated, (round(x - rotated.width / 2), round(y - rotated.height / 2)), rotated)


def draw_axes_png(
    image: Image.Image,
    draw: ImageDraw.ImageDraw,
    plot: tuple[int, int, int, int],
    title: str,
    x_label: str,
    y_label: str,
) -> None:
    left, top, width, height = plot
    bottom = top + height
    right = left + width
    png_text(draw, left, 28, title, 22, bold=False)
    draw.line((left, bottom, right, bottom), fill="#333333", width=1)
    draw.line((left, top, left, bottom), fill="#333333", width=1)
    png_text(draw, left + width / 2, bottom + 46, x_label, 14, "middle")
    png_rotated_text(image, left - 52, top + height / 2, y_label, 14, -90)


def marker_png(
    draw: ImageDraw.ImageDraw,
    x: float,
    y: float,
    method: str,
    color: str,
    size: float = 3.6,
) -> None:
    fill = hex_to_rgb(color)
    if method == "CMA-ES":
        points = [
            (x, y - size * 1.25),
            (x - size * 1.1, y + size),
            (x + size * 1.1, y + size),
        ]
        draw.polygon(points, fill=fill)
    else:
        draw.ellipse((x - size, y - size, x + size, y + size), fill=fill)


def draw_axes(content: list[str], plot: tuple[int, int, int, int], title: str, x_label: str, y_label: str) -> None:
    left, top, width, height = plot
    bottom = top + height
    right = left + width
    content.append(text(left, 34, title, 22))
    content.append(f'<line x1="{left}" y1="{bottom}" x2="{right}" y2="{bottom}" stroke="#333"/>')
    content.append(f'<line x1="{left}" y1="{top}" x2="{left}" y2="{bottom}" stroke="#333"/>')
    content.append(text(left + width / 2, bottom + 46, x_label, 14, "middle"))
    content.append(
        f'<text x="{left - 52}" y="{top + height / 2}" font-family="Arial, sans-serif" '
        f'font-size="14" text-anchor="middle" fill="#222" transform="rotate(-90 {left - 52} {top + height / 2})">'
        f'{html.escape(y_label)}</text>'
    )


def marker(x: float, y: float, method: str, color: str, opacity: float = 0.68, size: float = 3.6) -> str:
    if method == "CMA-ES":
        points = [
            (x, y - size * 1.25),
            (x - size * 1.1, y + size),
            (x + size * 1.1, y + size),
        ]
        point_text = " ".join(f"{px:.1f},{py:.1f}" for px, py in points)
        return f'<polygon points="{point_text}" fill="{color}" fill-opacity="{opacity}" stroke="none"/>'
    return f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{size:.1f}" fill="{color}" fill-opacity="{opacity}" stroke="none"/>'


def pca_scatter_svg(
    rows: list[dict[str, object]],
    scores: np.ndarray,
    explained: np.ndarray,
    out_path: Path,
    title: str,
    color_mode: str,
    max_points: int,
    axis_bounds: tuple[float, float, float, float] | None = None,
    fitness_bounds: tuple[float, float] | None = None,
) -> None:
    width, height = 1000, 760
    plot = (92, 66, 720, 590)
    left, top, plot_width, plot_height = plot
    if axis_bounds:
        x_low, x_high, y_low, y_high = axis_bounds
    else:
        x_low, x_high = bounds(scores[:, 0])
        y_low, y_high = bounds(scores[:, 1])
    fitness_values = np.array([float(row["fitness"]) for row in rows])
    f_low, f_high = fitness_bounds or bounds(fitness_values)
    content: list[str] = []
    draw_axes(
        content,
        plot,
        title,
        f"PC1 ({explained[0] * 100:.1f}% variance)",
        f"PC2 ({explained[1] * 100:.1f}% variance)",
    )
    for index in sampled_indices(len(rows), max_points):
        row = rows[index]
        x = scale(scores[index, 0], x_low, x_high, left, left + plot_width)
        y = scale(scores[index, 1], y_low, y_high, top + plot_height, top)
        if color_mode == "method":
            color = METHOD_COLORS.get(str(row["method"]), "#4b5563")
        else:
            color = fitness_color(float(row["fitness"]), f_low, f_high)
        content.append(marker(x, y, str(row["method"]), color))
    content.append(text(838, 92, "Method", 14))
    content.append(marker(848, 118, "GA", METHOD_COLORS["GA"], 0.9, 5))
    content.append(text(864, 123, "GA", 13))
    content.append(marker(848, 145, "CMA-ES", METHOD_COLORS["CMA-ES"], 0.9, 5))
    content.append(text(864, 150, "CMA-ES", 13))
    if color_mode == "fitness":
        content.append(text(838, 188, "Fitness", 14))
        for i in range(80):
            t = i / 79
            color = fitness_color(f_low + (f_high - f_low) * t, f_low, f_high)
            y = 368 - i * 2
            content.append(f'<rect x="842" y="{y:.1f}" width="24" height="2.2" fill="{color}"/>')
        content.append(text(874, 210, f"{f_high:.3f}", 12))
        content.append(text(874, 372, f"{f_low:.3f}", 12))
    content.append(text(92, 716, f"Rows plotted: {min(len(rows), max_points)} of {len(rows)}", 12))
    out_path.write_text(svg_page(width, height, content), encoding="utf-8")


def pca_scatter_png(
    rows: list[dict[str, object]],
    scores: np.ndarray,
    explained: np.ndarray,
    out_path: Path,
    title: str,
    color_mode: str,
    max_points: int,
    axis_bounds: tuple[float, float, float, float] | None = None,
    fitness_bounds: tuple[float, float] | None = None,
) -> None:
    width, height = 1000, 760
    plot = (92, 66, 720, 590)
    left, top, plot_width, plot_height = plot
    if axis_bounds:
        x_low, x_high, y_low, y_high = axis_bounds
    else:
        x_low, x_high = bounds(scores[:, 0])
        y_low, y_high = bounds(scores[:, 1])
    fitness_values = np.array([float(row["fitness"]) for row in rows])
    f_low, f_high = fitness_bounds or bounds(fitness_values)
    image, draw = png_canvas(width, height)
    draw_axes_png(
        image,
        draw,
        plot,
        title,
        f"PC1 ({explained[0] * 100:.1f}% variance)",
        f"PC2 ({explained[1] * 100:.1f}% variance)",
    )
    for index in sampled_indices(len(rows), max_points):
        row = rows[index]
        x = scale(scores[index, 0], x_low, x_high, left, left + plot_width)
        y = scale(scores[index, 1], y_low, y_high, top + plot_height, top)
        color = METHOD_COLORS.get(str(row["method"]), "#4b5563") if color_mode == "method" else fitness_color(float(row["fitness"]), f_low, f_high)
        marker_png(draw, x, y, str(row["method"]), color)
    png_text(draw, 838, 92, "Method", 14)
    marker_png(draw, 848, 118, "GA", METHOD_COLORS["GA"], 5)
    png_text(draw, 864, 123, "GA", 13)
    marker_png(draw, 848, 145, "CMA-ES", METHOD_COLORS["CMA-ES"], 5)
    png_text(draw, 864, 150, "CMA-ES", 13)
    if color_mode == "fitness":
        png_text(draw, 838, 188, "Fitness", 14)
        for i in range(160):
            t = i / 159
            color = fitness_color(f_low + (f_high - f_low) * t, f_low, f_high)
            y = 368 - i
            draw.rectangle((842, y, 866, y + 1), fill=hex_to_rgb(color))
        png_text(draw, 874, 210, f"{f_high:.3f}", 12)
        png_text(draw, 874, 372, f"{f_low:.3f}", 12)
    png_text(draw, 92, 716, f"Rows plotted: {min(len(rows), max_points)} of {len(rows)}", 12)
    image.save(out_path, "PNG")


def safe_name(value: str) -> str:
    return "".join(char if char.isalnum() else "_" for char in value).strip("_")


def best_paths_svg(
    rows: list[dict[str, object]],
    scores: np.ndarray,
    explained: np.ndarray,
    out_path: Path,
) -> None:
    width, height = 1000, 760
    plot = (92, 66, 720, 590)
    left, top, plot_width, plot_height = plot
    x_low, x_high = bounds(scores[:, 0])
    y_low, y_high = bounds(scores[:, 1])
    grouped: dict[tuple[str, str], list[int]] = defaultdict(list)
    for index, row in enumerate(rows):
        grouped[(str(row["method"]), str(row["optimizerRun"]))].append(index)
    content: list[str] = []
    draw_axes(
        content,
        plot,
        "Best strategy trajectory by generation",
        f"PC1 ({explained[0] * 100:.1f}% variance)",
        f"PC2 ({explained[1] * 100:.1f}% variance)",
    )
    for (method, run), indices in sorted(grouped.items()):
        by_generation: dict[int, int] = {}
        for index in indices:
            generation = int(rows[index]["generation"])
            current = by_generation.get(generation)
            if current is None or float(rows[index]["fitness"]) > float(rows[current]["fitness"]):
                by_generation[generation] = index
        path_indices = [by_generation[generation] for generation in sorted(by_generation)]
        points = []
        for index in path_indices:
            x = scale(scores[index, 0], x_low, x_high, left, left + plot_width)
            y = scale(scores[index, 1], y_low, y_high, top + plot_height, top)
            points.append((x, y))
        if len(points) >= 2:
            path_data = " ".join(f"{x:.1f},{y:.1f}" for x, y in points)
            content.append(
                f'<polyline points="{path_data}" fill="none" stroke="{METHOD_COLORS.get(method, "#555")}" '
                f'stroke-width="1.6" stroke-opacity="0.42"/>'
            )
        for x, y in points:
            content.append(marker(x, y, method, METHOD_COLORS.get(method, "#555"), 0.78, 3.2))
    content.append(text(838, 92, "Each line is one optimizer run.", 13))
    content.append(text(838, 116, "Points are the best individual", 13))
    content.append(text(838, 140, "found in each generation.", 13))
    content.append(marker(848, 194, "GA", METHOD_COLORS["GA"], 0.9, 5))
    content.append(text(864, 199, "GA", 13))
    content.append(marker(848, 222, "CMA-ES", METHOD_COLORS["CMA-ES"], 0.9, 5))
    content.append(text(864, 227, "CMA-ES", 13))
    out_path.write_text(svg_page(width, height, content), encoding="utf-8")


def best_paths_png(
    rows: list[dict[str, object]],
    scores: np.ndarray,
    explained: np.ndarray,
    out_path: Path,
) -> None:
    width, height = 1000, 760
    plot = (92, 66, 720, 590)
    left, top, plot_width, plot_height = plot
    x_low, x_high = bounds(scores[:, 0])
    y_low, y_high = bounds(scores[:, 1])
    grouped: dict[tuple[str, str], list[int]] = defaultdict(list)
    for index, row in enumerate(rows):
        grouped[(str(row["method"]), str(row["optimizerRun"]))].append(index)
    image, draw = png_canvas(width, height)
    draw_axes_png(
        image,
        draw,
        plot,
        "Best strategy trajectory by generation",
        f"PC1 ({explained[0] * 100:.1f}% variance)",
        f"PC2 ({explained[1] * 100:.1f}% variance)",
    )
    for (method, run), indices in sorted(grouped.items()):
        by_generation: dict[int, int] = {}
        for index in indices:
            generation = int(rows[index]["generation"])
            current = by_generation.get(generation)
            if current is None or float(rows[index]["fitness"]) > float(rows[current]["fitness"]):
                by_generation[generation] = index
        path_indices = [by_generation[generation] for generation in sorted(by_generation)]
        points = []
        for index in path_indices:
            x = scale(scores[index, 0], x_low, x_high, left, left + plot_width)
            y = scale(scores[index, 1], y_low, y_high, top + plot_height, top)
            points.append((x, y))
        if len(points) >= 2:
            draw.line(points, fill=hex_to_rgb(METHOD_COLORS.get(method, "#555555")), width=2)
        for x, y in points:
            marker_png(draw, x, y, method, METHOD_COLORS.get(method, "#555555"), 3.2)
    png_text(draw, 838, 92, "Each line is one optimizer run.", 13)
    png_text(draw, 838, 116, "Points are the best individual", 13)
    png_text(draw, 838, 140, "found in each generation.", 13)
    marker_png(draw, 848, 194, "GA", METHOD_COLORS["GA"], 5)
    png_text(draw, 864, 199, "GA", 13)
    marker_png(draw, 848, 222, "CMA-ES", METHOD_COLORS["CMA-ES"], 5)
    png_text(draw, 864, 227, "CMA-ES", 13)
    image.save(out_path, "PNG")


def loadings_svg(weights: list[str], vt: np.ndarray, explained: np.ndarray, out_path: Path) -> None:
    width, height = 980, 620
    left, top, plot_width, plot_height = 92, 72, 800, 390
    content: list[str] = [text(left, 36, "PCA loadings by weight", 22)]
    zero_y = top + plot_height / 2
    content.append(f'<line x1="{left}" y1="{zero_y:.1f}" x2="{left + plot_width}" y2="{zero_y:.1f}" stroke="#444"/>')
    content.append(f'<line x1="{left}" y1="{top}" x2="{left}" y2="{top + plot_height}" stroke="#333"/>')
    bar_group = plot_width / len(weights)
    max_abs = max(0.01, float(np.max(np.abs(vt[:2, :]))))
    for i, weight in enumerate(weights):
        center = left + bar_group * i + bar_group / 2
        for component, color, offset in [(0, "#2563eb", -9), (1, "#dc2626", 9)]:
            value = float(vt[component, i])
            bar_height = abs(value) / max_abs * (plot_height / 2 - 16)
            y = zero_y - bar_height if value >= 0 else zero_y
            content.append(
                f'<rect x="{center + offset - 7:.1f}" y="{y:.1f}" width="14" height="{bar_height:.1f}" '
                f'fill="{color}" fill-opacity="0.78"/>'
            )
        content.append(
            f'<text x="{center:.1f}" y="{top + plot_height + 34}" font-family="Arial, sans-serif" '
            f'font-size="12" text-anchor="middle" fill="#222" transform="rotate(-35 {center:.1f} {top + plot_height + 34})">'
            f'{html.escape(weight)}</text>'
        )
    content.append(text(left, 528, f"PC1 variance: {explained[0] * 100:.1f}%", 14))
    content.append(text(left + 260, 528, f"PC2 variance: {explained[1] * 100:.1f}%", 14))
    content.append(f'<rect x="{left}" y="556" width="16" height="16" fill="#2563eb" fill-opacity="0.78"/>')
    content.append(text(left + 24, 569, "PC1", 13))
    content.append(f'<rect x="{left + 92}" y="556" width="16" height="16" fill="#dc2626" fill-opacity="0.78"/>')
    content.append(text(left + 116, 569, "PC2", 13))
    out_path.write_text(svg_page(width, height, content), encoding="utf-8")


def loadings_png(weights: list[str], vt: np.ndarray, explained: np.ndarray, out_path: Path) -> None:
    width, height = 980, 620
    left, top, plot_width, plot_height = 92, 72, 800, 390
    image, draw = png_canvas(width, height)
    png_text(draw, left, 30, "PCA loadings by weight", 22)
    zero_y = top + plot_height / 2
    draw.line((left, zero_y, left + plot_width, zero_y), fill="#444444", width=1)
    draw.line((left, top, left, top + plot_height), fill="#333333", width=1)
    bar_group = plot_width / len(weights)
    max_abs = max(0.01, float(np.max(np.abs(vt[:2, :]))))
    for i, weight in enumerate(weights):
        center = left + bar_group * i + bar_group / 2
        for component, color, offset in [(0, "#2563eb", -9), (1, "#dc2626", 9)]:
            value = float(vt[component, i])
            bar_height = abs(value) / max_abs * (plot_height / 2 - 16)
            y = zero_y - bar_height if value >= 0 else zero_y
            draw.rectangle(
                (center + offset - 7, y, center + offset + 7, y + bar_height),
                fill=hex_to_rgb(color),
            )
        png_rotated_text(image, center, top + plot_height + 45, weight, 12, -35)
    png_text(draw, left, 528, f"PC1 variance: {explained[0] * 100:.1f}%", 14)
    png_text(draw, left + 260, 528, f"PC2 variance: {explained[1] * 100:.1f}%", 14)
    draw.rectangle((left, 556, left + 16, 572), fill=hex_to_rgb("#2563eb"))
    png_text(draw, left + 24, 564, "PC1", 13)
    draw.rectangle((left + 92, 556, left + 108, 572), fill=hex_to_rgb("#dc2626"))
    png_text(draw, left + 116, 564, "PC2", 13)
    image.save(out_path, "PNG")


def pair_matrix_svg(
    rows: list[dict[str, object]],
    weights: list[str],
    out_path: Path,
    max_points: int,
) -> None:
    count = len(weights)
    cell = 142
    margin_left = 88
    margin_top = 72
    width = margin_left + cell * count + 40
    height = margin_top + cell * count + 72
    data = np.array([row["weights"] for row in rows], dtype=float)
    fitness_values = np.array([float(row["fitness"]) for row in rows])
    f_low, f_high = bounds(fitness_values)
    indices = sampled_indices(len(rows), max_points)
    content = [text(margin_left, 36, "Weight pair scatter matrix", 22)]
    for row_i, y_weight in enumerate(weights):
        for col_i, x_weight in enumerate(weights):
            x0 = margin_left + col_i * cell
            y0 = margin_top + row_i * cell
            if row_i == col_i:
                content.append(text(x0 + cell / 2, y0 + cell / 2, x_weight, 12, "middle"))
                continue
            content.append(f'<rect x="{x0}" y="{y0}" width="{cell - 12}" height="{cell - 12}" fill="#f8fafc" stroke="#d1d5db"/>')
            x_low, x_high = bounds(data[:, col_i])
            y_low, y_high = bounds(data[:, row_i])
            for index in indices:
                x = scale(data[index, col_i], x_low, x_high, x0 + 8, x0 + cell - 20)
                y = scale(data[index, row_i], y_low, y_high, y0 + cell - 20, y0 + 8)
                color = fitness_color(float(rows[index]["fitness"]), f_low, f_high)
                content.append(marker(x, y, str(rows[index]["method"]), color, 0.45, 2.0))
        content.append(text(14, margin_top + row_i * cell + cell / 2, y_weight, 11))
    for col_i, x_weight in enumerate(weights):
        content.append(
            f'<text x="{margin_left + col_i * cell + cell / 2:.1f}" y="{height - 28}" '
            f'font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#222" '
            f'transform="rotate(-30 {margin_left + col_i * cell + cell / 2:.1f} {height - 28})">'
            f'{html.escape(x_weight)}</text>'
        )
    out_path.write_text(svg_page(width, height, content), encoding="utf-8")


def pair_matrix_png(
    rows: list[dict[str, object]],
    weights: list[str],
    out_path: Path,
    max_points: int,
) -> None:
    count = len(weights)
    cell = 142
    margin_left = 88
    margin_top = 72
    width = margin_left + cell * count + 40
    height = margin_top + cell * count + 72
    data = np.array([row["weights"] for row in rows], dtype=float)
    fitness_values = np.array([float(row["fitness"]) for row in rows])
    f_low, f_high = bounds(fitness_values)
    indices = sampled_indices(len(rows), max_points)
    image, draw = png_canvas(width, height)
    png_text(draw, margin_left, 30, "Weight pair scatter matrix", 22)
    for row_i, y_weight in enumerate(weights):
        for col_i, x_weight in enumerate(weights):
            x0 = margin_left + col_i * cell
            y0 = margin_top + row_i * cell
            if row_i == col_i:
                png_text(draw, x0 + cell / 2, y0 + cell / 2, x_weight, 12, "middle")
                continue
            draw.rectangle((x0, y0, x0 + cell - 12, y0 + cell - 12), fill="#f8fafc", outline="#d1d5db")
            x_low, x_high = bounds(data[:, col_i])
            y_low, y_high = bounds(data[:, row_i])
            for index in indices:
                x = scale(data[index, col_i], x_low, x_high, x0 + 8, x0 + cell - 20)
                y = scale(data[index, row_i], y_low, y_high, y0 + cell - 20, y0 + 8)
                color = fitness_color(float(rows[index]["fitness"]), f_low, f_high)
                marker_png(draw, x, y, str(rows[index]["method"]), color, 2.0)
        png_text(draw, 14, margin_top + row_i * cell + cell / 2, y_weight, 11)
    for col_i, x_weight in enumerate(weights):
        png_rotated_text(image, margin_left + col_i * cell + cell / 2, height - 30, x_weight, 11, -30)
    image.save(out_path, "PNG")


def write_scores_csv(
    out_path: Path,
    rows: list[dict[str, object]],
    scores: np.ndarray,
    weights: list[str],
) -> None:
    columns = [
        "row",
        "method",
        "experimentGroup",
        "configName",
        "optimizerRun",
        "optimizerSeed",
        "generation",
        "individual",
        "rank",
        "evaluation",
        "fitness",
        "targetScore",
        "formationScore",
        "constraintScore",
        "PC1",
        "PC2",
    ] + weights
    with out_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for index, row in enumerate(rows):
            record = {column: row.get(column, "") for column in columns}
            record["PC1"] = scores[index, 0]
            record["PC2"] = scores[index, 1]
            for weight, value in zip(weights, row["weights"]):
                record[weight] = value
            writer.writerow(record)


def write_summary_csv(
    out_path: Path,
    rows: list[dict[str, object]],
    weights: list[str],
    vt: np.ndarray,
    explained: np.ndarray,
    mean: np.ndarray,
    std: np.ndarray,
) -> None:
    with out_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["section", "name", "value"])
        writer.writerow(["pca", "rows", len(rows)])
        writer.writerow(["pca", "weights", "|".join(weights)])
        writer.writerow(["pca", "pc1_explained_variance", explained[0]])
        writer.writerow(["pca", "pc2_explained_variance", explained[1]])
        for method in sorted({str(row["method"]) for row in rows}):
            fitness = [float(row["fitness"]) for row in rows if row["method"] == method]
            writer.writerow([method, "rows", len(fitness)])
            writer.writerow([method, "fitness_mean", float(np.mean(fitness))])
            writer.writerow([method, "fitness_std", float(np.std(fitness))])
            writer.writerow([method, "fitness_min", min(fitness)])
            writer.writerow([method, "fitness_max", max(fitness)])
        for index, weight in enumerate(weights):
            writer.writerow(["weight_mean", weight, mean[index]])
            writer.writerow(["weight_std", weight, std[index]])
            writer.writerow(["pc1_loading", weight, vt[0, index]])
            writer.writerow(["pc2_loading", weight, vt[1, index]])


def main() -> None:
    args = parse_args()
    rows, fieldnames = load_rows(args.history_csv)
    weights = choose_weights(fieldnames, args.weights, rows)
    cleaned = clean_rows(rows, weights)
    data = np.array([row["weights"] for row in cleaned], dtype=float)
    scores, vt, explained, mean, std = compute_pca(data)
    axis_bounds = (
        *bounds(scores[:, 0]),
        *bounds(scores[:, 1]),
    )
    fitness_values = np.array([float(row["fitness"]) for row in cleaned])
    fitness_bounds = bounds(fitness_values)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    write_scores_csv(args.out_dir / "pca_scores.csv", cleaned, scores, weights)
    write_summary_csv(args.out_dir / "strategy_summary.csv", cleaned, weights, vt, explained, mean, std)
    pca_scatter_svg(
        cleaned,
        scores,
        explained,
        args.out_dir / "strategy_pca_fitness.svg",
        "Strategy-space PCA colored by fitness",
        "fitness",
        args.max_points,
        axis_bounds,
        fitness_bounds,
    )
    pca_scatter_png(
        cleaned,
        scores,
        explained,
        args.out_dir / "strategy_pca_fitness.png",
        "Strategy-space PCA colored by fitness",
        "fitness",
        args.max_points,
        axis_bounds,
        fitness_bounds,
    )
    pca_scatter_svg(
        cleaned,
        scores,
        explained,
        args.out_dir / "strategy_pca_method.svg",
        "Strategy-space PCA colored by optimizer",
        "method",
        args.max_points,
        axis_bounds,
        fitness_bounds,
    )
    pca_scatter_png(
        cleaned,
        scores,
        explained,
        args.out_dir / "strategy_pca_method.png",
        "Strategy-space PCA colored by optimizer",
        "method",
        args.max_points,
        axis_bounds,
        fitness_bounds,
    )
    for method in sorted({str(row["method"]) for row in cleaned}):
        indices = [index for index, row in enumerate(cleaned) if row["method"] == method]
        method_rows = [cleaned[index] for index in indices]
        method_scores = scores[indices, :]
        method_name = safe_name(method)
        pca_scatter_svg(
            method_rows,
            method_scores,
            explained,
            args.out_dir / f"strategy_pca_fitness_{method_name}.svg",
            f"{method} strategy-space PCA colored by fitness",
            "fitness",
            args.max_points,
            axis_bounds,
            fitness_bounds,
        )
        pca_scatter_png(
            method_rows,
            method_scores,
            explained,
            args.out_dir / f"strategy_pca_fitness_{method_name}.png",
            f"{method} strategy-space PCA colored by fitness",
            "fitness",
            args.max_points,
            axis_bounds,
            fitness_bounds,
        )
    best_paths_svg(cleaned, scores, explained, args.out_dir / "strategy_pca_best_paths.svg")
    best_paths_png(cleaned, scores, explained, args.out_dir / "strategy_pca_best_paths.png")
    loadings_svg(weights, vt, explained, args.out_dir / "pca_loadings.svg")
    loadings_png(weights, vt, explained, args.out_dir / "pca_loadings.png")
    pair_matrix_svg(cleaned, weights, args.out_dir / "weight_pair_matrix.svg", args.max_points)
    pair_matrix_png(cleaned, weights, args.out_dir / "weight_pair_matrix.png", args.max_points)
    print(f"Rows analyzed: {len(cleaned)}")
    print("Weights: " + ", ".join(weights))
    print(f"PC1 variance: {explained[0] * 100:.2f}%")
    print(f"PC2 variance: {explained[1] * 100:.2f}%")
    print(f"Output folder: {args.out_dir}")


if __name__ == "__main__":
    main()
