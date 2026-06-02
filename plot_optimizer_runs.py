from __future__ import annotations

import argparse
import csv
import html
import math
import statistics
from collections import defaultdict
from pathlib import Path

try:
    import matplotlib.pyplot as plt
except ModuleNotFoundError:
    plt = None


DEFAULT_METRICS = [
    "fitness",
    "targets",
    "targetTime",
    "order",
    "nn",
    "spacingScore",
    "cluster",
    "collisionRate",
    "targetScore",
    "formationScore",
    "constraintScore",
]

METRIC_LABELS = {
    "fitness": "Fitness",
    "targets": "Targets reached",
    "targetTime": "Mean time to target",
    "order": "Order",
    "nn": "Nearest-neighbor distance",
    "spacingScore": "Spacing score",
    "cluster": "Cluster",
    "collisionRate": "Collision rate",
    "targetScore": "Target score",
    "formationScore": "Formation score",
    "constraintScore": "Constraint score",
}

SCORE_METRICS = {
    "fitness",
    "order",
    "spacingScore",
    "cluster",
    "collisionRate",
    "targetScore",
    "formationScore",
    "constraintScore",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Plot run-by-run metrics from Boids repeated-test CSV exports."
    )
    parser.add_argument(
        "files",
        nargs="+",
        type=Path,
        help="One or more repeated-test CSV exports.",
    )
    parser.add_argument(
        "--metrics",
        default=",".join(DEFAULT_METRICS),
        help="Comma-separated metrics to plot.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("boids_run_metrics.svg"),
        help="Output path. SVG works without extra packages; PNG needs matplotlib.",
    )
    parser.add_argument(
        "--summary-csv",
        type=Path,
        help="Optional CSV path for mean/std/min/max summary statistics.",
    )
    parser.add_argument(
        "--individual-png-dir",
        type=Path,
        help="Optional folder where each metric plot is saved as a separate PNG.",
    )
    parser.add_argument(
        "--no-show",
        action="store_true",
        help="Save without opening a matplotlib window.",
    )
    return parser.parse_args()


def to_float(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def metric_list(raw_metrics: str) -> list[str]:
    return [metric.strip() for metric in raw_metrics.split(",") if metric.strip()]


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


def load_rows(files: list[Path]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for file_path in files:
        if file_path.suffix.lower() != ".csv":
            raise ValueError(
                f"{file_path} is not a CSV file. Export the Numbers file as CSV first."
            )
        with file_path.open(newline="", encoding="utf-8") as handle:
            reader = csv_reader(handle)
            if not reader.fieldnames:
                raise ValueError(f"{file_path} has no CSV header.")
            for row in reader:
                row_type = row.get("type", "")
                if row_type and row_type != "repeated-run":
                    continue
                row["_file"] = file_path.stem
                rows.append(row)
    if not rows:
        raise ValueError("No repeated-run rows were found in the CSV file(s).")
    return rows


def run_index(row: dict[str, str], fallback: int) -> float:
    return (
        to_float(row.get("runIndex"))
        or to_float(row.get("run"))
        or to_float(row.get("seed"))
        or fallback
    )


def row_label(row: dict[str, str]) -> str:
    source = row.get("source")
    method = row.get("method")
    file_name = row.get("_file")
    if source and method and source != method:
        return f"{source} ({method})"
    return source or method or file_name or "Unknown"


def group_rows(rows: list[dict[str, str]]) -> dict[str, list[dict[str, str]]]:
    groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        groups[row_label(row)].append(row)
    for group_rows_ in groups.values():
        original_order = {id(row): index + 1 for index, row in enumerate(group_rows_)}
        group_rows_.sort(
            key=lambda row: run_index(row, original_order[id(row)])
        )
    return dict(groups)


def available_metrics(rows: list[dict[str, str]], requested: list[str]) -> list[str]:
    result = []
    for metric in requested:
        if any(to_float(row.get(metric)) is not None for row in rows):
            result.append(metric)
    if not result:
        available = sorted(
            column
            for row in rows
            for column in row
            if column != "_file" and to_float(row.get(column)) is not None
        )
        raise ValueError(
            "None of the requested metrics are available. Numeric columns: "
            + ", ".join(available)
        )
    return result


def values_for(rows: list[dict[str, str]], metric: str) -> list[float]:
    return [
        value
        for value in (to_float(row.get(metric)) for row in rows)
        if value is not None
    ]


def print_summary(groups: dict[str, list[dict[str, str]]], metrics: list[str]) -> None:
    print("\nRun metric summary")
    print("=" * 18)
    for label, rows in groups.items():
        print(f"\n{label}: {len(rows)} run(s)")
        for metric in metrics:
            values = values_for(rows, metric)
            if not values:
                continue
            mean = statistics.fmean(values)
            std = statistics.stdev(values) if len(values) > 1 else 0.0
            minimum = min(values)
            maximum = max(values)
            metric_label = METRIC_LABELS.get(metric, metric)
            print(
                f"  {metric_label:26s} mean={mean:.4f} "
                f"std={std:.4f} min={minimum:.4f} max={maximum:.4f}"
            )


def metric_bounds(
    groups: dict[str, list[dict[str, str]]],
    metric: str,
) -> tuple[float, float]:
    if metric in SCORE_METRICS:
        return 0.0, 1.0
    values = [
        value
        for rows in groups.values()
        for value in values_for(rows, metric)
    ]
    if not values:
        return 0.0, 1.0
    low = min(values)
    high = max(values)
    if low == high:
        padding = abs(low) * 0.1 or 1.0
        return low - padding, high + padding
    padding = (high - low) * 0.08
    return low - padding, high + padding


def run_bounds(groups: dict[str, list[dict[str, str]]]) -> tuple[float, float]:
    values = [
        run_index(row, index + 1)
        for rows in groups.values()
        for index, row in enumerate(rows)
    ]
    if not values:
        return 1.0, 1.0
    low = min(values)
    high = max(values)
    return (low, high) if low != high else (low, low + 1.0)


def svg_text(x: float, y: float, text: str, size: int = 12, anchor: str = "start") -> str:
    return (
        f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" '
        f'font-family="Arial, sans-serif" text-anchor="{anchor}" '
        f'fill="#222">{html.escape(text)}</text>'
    )


def svg_polyline(points: list[tuple[float, float]], color: str) -> str:
    point_text = " ".join(f"{x:.2f},{y:.2f}" for x, y in points)
    return (
        f'<polyline points="{point_text}" fill="none" stroke="{color}" '
        f'stroke-width="2"/>'
    )


def write_svg(
    path: Path,
    groups: dict[str, list[dict[str, str]]],
    metrics: list[str],
) -> None:
    palette = [
        "#1b7f83",
        "#d95f02",
        "#4b68b8",
        "#7a3c99",
        "#2a9d55",
        "#c43c39",
    ]
    row_count, column_count = grid_shape(len(metrics))
    panel_width = 520
    panel_height = 350
    width = panel_width * column_count
    height = panel_height * row_count + 54
    x_low, x_high = run_bounds(groups)
    elements = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" fill="white"/>',
        svg_text(width / 2, 28, "Boids repeated-test metrics across runs", 18, "middle"),
    ]

    for metric_index, metric in enumerate(metrics):
        col = metric_index % column_count
        row = metric_index // column_count
        left = col * panel_width + 58
        top = row * panel_height + 74
        plot_width = panel_width - 96
        plot_height = panel_height - 108
        y_low, y_high = metric_bounds(groups, metric)

        def sx(value: float) -> float:
            return left + (value - x_low) / (x_high - x_low) * plot_width

        def sy(value: float) -> float:
            return top + plot_height - (value - y_low) / (y_high - y_low) * plot_height

        elements.append(svg_text(left, top - 26, METRIC_LABELS.get(metric, metric), 14))
        elements.append(
            f'<rect x="{left:.1f}" y="{top:.1f}" width="{plot_width:.1f}" height="{plot_height:.1f}" fill="#f8f8f8" stroke="#bbb"/>'
        )
        for tick in range(5):
            y_value = y_low + (y_high - y_low) * tick / 4
            y = sy(y_value)
            elements.append(
                f'<line x1="{left:.1f}" x2="{left + plot_width:.1f}" y1="{y:.1f}" y2="{y:.1f}" stroke="#ddd"/>'
            )
            elements.append(svg_text(left - 8, y + 4, f"{y_value:.2g}", 10, "end"))
        for tick in range(5):
            x_value = x_low + (x_high - x_low) * tick / 4
            x = sx(x_value)
            elements.append(
                f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{top:.1f}" y2="{top + plot_height:.1f}" stroke="#eee"/>'
            )
            elements.append(svg_text(x, top + plot_height + 18, f"{x_value:.0f}", 10, "middle"))

        for group_index, (label, rows) in enumerate(groups.items()):
            color = palette[group_index % len(palette)]
            points = []
            for index, data_row in enumerate(rows):
                value = to_float(data_row.get(metric))
                if value is None:
                    continue
                points.append((sx(run_index(data_row, index + 1)), sy(value)))
            if len(points) >= 2:
                elements.append(svg_polyline(points, color))
            for x, y in points:
                elements.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="2.8" fill="{color}"/>')

        legend_y = top + plot_height + 38
        legend_x = left
        for group_index, label in enumerate(groups):
            color = palette[group_index % len(palette)]
            x = legend_x + group_index * 140
            elements.append(f'<line x1="{x:.1f}" x2="{x + 18:.1f}" y1="{legend_y:.1f}" y2="{legend_y:.1f}" stroke="{color}" stroke-width="2"/>')
            elements.append(svg_text(x + 24, legend_y + 4, label, 10))

    elements.append("</svg>")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(elements), encoding="utf-8")


def write_summary_csv(
    path: Path,
    groups: dict[str, list[dict[str, str]]],
    metrics: list[str],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["group", "metric", "runs", "mean", "std", "min", "max"])
        for label, rows in groups.items():
            for metric in metrics:
                values = values_for(rows, metric)
                if not values:
                    continue
                writer.writerow(
                    [
                        label,
                        metric,
                        len(values),
                        statistics.fmean(values),
                        statistics.stdev(values) if len(values) > 1 else 0.0,
                        min(values),
                        max(values),
                    ]
                )


def grid_shape(count: int) -> tuple[int, int]:
    columns = 2 if count <= 4 else 3
    rows = math.ceil(count / columns)
    return rows, columns


def slugify(value: str) -> str:
    result = []
    previous_separator = False
    for char in value.lower():
        if char.isalnum():
            result.append(char)
            previous_separator = False
        elif not previous_separator:
            result.append("_")
            previous_separator = True
    return "".join(result).strip("_") or "metric"


def plot_metric(ax, groups: dict[str, list[dict[str, str]]], metric: str) -> None:
    for label, rows in groups.items():
        points = [
            (run_index(row, index + 1), to_float(row.get(metric)))
            for index, row in enumerate(rows)
        ]
        points = [(x, y) for x, y in points if y is not None]
        if not points:
            continue
        x_values, y_values = zip(*points)
        ax.plot(x_values, y_values, marker="o", linewidth=1.4, markersize=3, label=label)
    ax.set_title(METRIC_LABELS.get(metric, metric))
    ax.set_xlabel("Run")
    ax.grid(True, alpha=0.25)
    if metric in SCORE_METRICS:
        ax.set_ylim(0, 1)
    ax.legend(fontsize=8, frameon=False)


def write_individual_pngs(
    output_dir: Path,
    groups: dict[str, list[dict[str, str]]],
    metrics: list[str],
) -> None:
    if plt is None:
        raise SystemExit(
            "matplotlib is needed for individual PNG exports. "
            "Install it with: pip install -r requirements.txt"
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    for metric in metrics:
        fig, ax = plt.subplots(figsize=(6.8, 4.4), constrained_layout=True)
        plot_metric(ax, groups, metric)
        ax.set_ylabel(METRIC_LABELS.get(metric, metric))
        output_path = output_dir / f"{slugify(METRIC_LABELS.get(metric, metric))}.png"
        fig.savefig(output_path, dpi=220)
        plt.close(fig)


def make_figure(rows: list[dict[str, str]], metrics: list[str]):
    groups = group_rows(rows)
    metrics = available_metrics(rows, metrics)
    print_summary(groups, metrics)

    if plt is None:
        return None, groups, metrics

    row_count, column_count = grid_shape(len(metrics))
    fig, axes = plt.subplots(
        row_count,
        column_count,
        figsize=(5.2 * column_count, 3.6 * row_count),
        constrained_layout=True,
        squeeze=False,
    )
    fig.suptitle("Boids repeated-test metrics across runs", fontsize=15)

    for ax, metric in zip(axes.flat, metrics):
        plot_metric(ax, groups, metric)
    for ax in axes.flat[len(metrics) :]:
        ax.axis("off")

    return fig, groups, metrics


def main() -> None:
    args = parse_args()
    rows = load_rows(args.files)
    fig, groups, metrics = make_figure(rows, metric_list(args.metrics))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    if fig is None:
        if args.output.suffix.lower() != ".svg":
            raise SystemExit(
                "matplotlib is needed for PNG/PDF output. Use --output plot.svg "
                "or install matplotlib."
            )
        write_svg(args.output, groups, metrics)
    else:
        fig.savefig(args.output, dpi=180)
    print(f"\nSaved graph to: {args.output.resolve()}")

    if args.summary_csv:
        write_summary_csv(args.summary_csv, groups, metrics)
        print(f"Saved summary CSV to: {args.summary_csv.resolve()}")

    if args.individual_png_dir:
        write_individual_pngs(args.individual_png_dir, groups, metrics)
        print(f"Saved individual PNG plots to: {args.individual_png_dir.resolve()}")

    if fig is not None and not args.no_show:
        plt.show()


if __name__ == "__main__":
    main()
