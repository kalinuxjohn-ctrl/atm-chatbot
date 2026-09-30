#!/usr/bin/env python3

import ast
import sys
from pathlib import Path

IGNORED_DIRS = {
    ".git",
    ".idea",
    ".vscode",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".tox",
    ".venv",
    "venv",
    "env",
    "build",
    "dist",
    "fcls",
    "README.md",
    "get-docker.sh",
    "main",
    "public",
    "tests",
    "docker-cache",
    "*.egg-info"
}

PYTHON_EXT = {".py"}


# ==========================================================
# PYTHON
# ==========================================================

def format_arguments(args):
    parts = []

    for arg in args.posonlyargs:
        parts.append(arg.arg)

    if args.posonlyargs:
        parts.append("/")

    for arg in args.args:
        parts.append(arg.arg)

    if args.vararg:
        parts.append("*" + args.vararg.arg)
    elif args.kwonlyargs:
        parts.append("*")

    for arg in args.kwonlyargs:
        parts.append(arg.arg)

    if args.kwarg:
        parts.append("**" + args.kwarg.arg)

    return ", ".join(parts)


def class_name(node):
    if not node.bases:
        return node.name

    bases = []

    for base in node.bases:
        try:
            bases.append(ast.unparse(base))
        except Exception:
            bases.append("?")

    return f"{node.name}({', '.join(bases)})"


def function_name(node):
    params = format_arguments(node.args)

    if isinstance(node, ast.AsyncFunctionDef):
        return f"async function {node.name}({params})"

    return f"function {node.name}({params})"


def method_name(node):
    params = format_arguments(node.args)

    if isinstance(node, ast.AsyncFunctionDef):
        return f"async {node.name}({params})"

    return f"{node.name}({params})"


def extract_class(node, prefix, output):
    output.append(prefix + "├── class " + class_name(node))

    methods = [
        child
        for child in node.body
        if isinstance(
            child,
            (ast.FunctionDef, ast.AsyncFunctionDef)
        )
    ]

    for index, method in enumerate(methods):
        last = index == len(methods) - 1

        connector = "└── " if last else "├── "
        output.append(
            prefix + "│   " + connector + method_name(method)
        )


def extract_python(file_path):
    output = []

    try:
        source = file_path.read_text(
            encoding="utf-8",
            errors="ignore"
        )

        tree = ast.parse(
            source,
            filename=str(file_path)
        )

        elements = [
            node
            for node in tree.body
            if isinstance(
                node,
                (
                    ast.ClassDef,
                    ast.FunctionDef,
                    ast.AsyncFunctionDef
                )
            )
        ]

        for index, node in enumerate(elements):
            last = index == len(elements) - 1
            connector = "└── " if last else "├── "

            if isinstance(node, ast.ClassDef):
                extract_class(
                    node,
                    "",
                    output
                )
            else:
                output.append(
                    connector + function_name(node)
                )

    except SyntaxError as e:
        output.append(
            f"└── PYTHON_PARSE_ERROR: line {e.lineno}: {e.msg}"
        )

    except Exception as e:
        output.append(
            f"└── PYTHON_ERROR: {e}"
        )

    return output


# ==========================================================
# TREE
# ==========================================================

def should_ignore(path):
    if path.name in IGNORED_DIRS:
        return True

    for pattern in IGNORED_DIRS:
        if pattern.startswith("*") and path.name.endswith(
            pattern[1:]
        ):
            return True

    return False


def analyze_file(path):
    if path.suffix.lower() in PYTHON_EXT:
        return extract_python(path)

    return []


def build_tree(directory, prefix=""):
    lines = []

    try:
        entries = sorted(
            [
                entry
                for entry in directory.iterdir()
                if not should_ignore(entry)
            ],
            key=lambda p: (
                p.is_file(),
                p.name.lower()
            )
        )
    except PermissionError:
        return [
            prefix + "└── [PERMISSION DENIED]"
        ]

    for index, entry in enumerate(entries):
        last = index == len(entries) - 1

        connector = "└── " if last else "├── "

        if entry.is_dir():
            lines.append(
                prefix + connector + entry.name + "/"
            )

            new_prefix = prefix + (
                "    " if last else "│   "
            )

            lines.extend(
                build_tree(
                    entry,
                    new_prefix
                )
            )

        elif entry.is_file():
            lines.append(
                prefix + connector + entry.name
            )

            analysis = analyze_file(entry)

            sub_prefix = prefix + (
                "    " if last else "│   "
            )

            for item in analysis:
                lines.append(
                    sub_prefix + item
                )

    return lines


# ==========================================================
# MAIN
# ==========================================================

def main():
    root = Path(
        sys.argv[1]
        if len(sys.argv) > 1
        else "."
    ).resolve()

    if not root.exists():
        print(f"[ERROR] Projet introuvable : {root}")
        sys.exit(1)

    if not root.is_dir():
        print(f"[ERROR] Ce chemin n'est pas un dossier : {root}")
        sys.exit(1)

    result = [root.name + "/"]
    result.extend(build_tree(root))

    output_file = root / "architecture.tree"

    output_file.write_text(
        "\n".join(result),
        encoding="utf-8"
    )

    print(f"[OK] {output_file}")


if __name__ == "__main__":
    main()