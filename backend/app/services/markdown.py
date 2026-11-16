"""Análisis ligero de Markdown estilo Obsidian: [[wikilinks]], #etiquetas y casillas - [ ]."""
import re
from typing import Iterator, List, Tuple

_FENCE = re.compile(r"^(\s*)(```|~~~)")
_INLINE_CODE = re.compile(r"`[^`\n]*`")
WIKILINK = re.compile(r"\[\[([^\[\]|#\n]+)(#[^\[\]|\n]*)?(\|[^\[\]\n]*)?\]\]")
_TAG = re.compile(r"(?<![\w/#&])#([A-Za-zÀ-ÿ_][\w/\-À-ÿ]*)")
CHECKBOX = re.compile(r"^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s+)(.*)$")


def frontmatter_end(lines: List[str]) -> int:
    """Número de líneas que ocupa el bloque YAML inicial (`---` … `---`) de Obsidian; 0 si no hay."""
    if not lines or lines[0].strip() != "---":
        return 0
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return i + 1
    return 0


def frontmatter_tags(content: str) -> List[str]:
    """Etiquetas declaradas en el frontmatter: `tags: [a, b]`, `tags: a, b` o lista con guiones."""
    lines = content.split("\n")
    out, in_list = [], False
    for line in lines[1 : max(frontmatter_end(lines) - 1, 1)]:
        m = re.match(r"^tags?:\s*(.*)$", line.strip()) if not line.startswith((" ", "\t", "-")) else None
        if m:
            value = m.group(1).strip().strip("[]")
            in_list = not value
            out += [v for v in re.split(r"[,\s]+", value) if v]
        elif in_list and line.strip().startswith("-"):
            out.append(line.strip()[1:].strip())
        elif line.strip():
            in_list = False
    return [t.strip("\"'#").lower() for t in out if t.strip("\"'#")]


def prose_lines(content: str) -> Iterator[Tuple[int, str]]:
    """Líneas fuera del frontmatter y de bloques de código, con el código en línea eliminado."""
    in_fence = False
    lines = content.split("\n")
    skip = frontmatter_end(lines)
    for i, line in enumerate(lines):
        if i < skip:
            continue
        if _FENCE.match(line):
            in_fence = not in_fence
            continue
        if not in_fence:
            yield i, _INLINE_CODE.sub("", line)


def extract_links(content: str) -> List[str]:
    seen, out = set(), []
    for _, line in prose_lines(content):
        for m in WIKILINK.finditer(line):
            title = " ".join(m.group(1).split())
            if title and title.lower() not in seen:
                seen.add(title.lower())
                out.append(title)
    return out


def extract_tags(content: str) -> List[str]:
    out = list(dict.fromkeys(frontmatter_tags(content)))
    seen = set(out)
    for _, line in prose_lines(content):
        # Los enlaces pueden contener "#sección": no son etiquetas
        for m in _TAG.finditer(WIKILINK.sub("", line)):
            tag = m.group(1).lower().strip("/-")
            if tag and tag not in seen:
                seen.add(tag)
                out.append(tag)
    return out


def extract_checklist(content: str) -> List[Tuple[int, str, bool]]:
    lines = content.split("\n")
    out = []
    for i, _ in prose_lines(content):
        m = CHECKBOX.match(lines[i])
        if m:
            out.append((i, m.group(4).strip(), m.group(2) != " "))
    return out


def toggle_checkbox(content: str, line: int, checked: bool) -> str:
    lines = content.split("\n")
    if line >= len(lines) or not CHECKBOX.match(lines[line]):
        raise ValueError("La línea indicada no es una casilla")
    lines[line] = CHECKBOX.sub(lambda m: f"{m.group(1)}{'x' if checked else ' '}{m.group(3)}{m.group(4)}", lines[line])
    return "\n".join(lines)


def convert_checkbox(content: str, line: int) -> Tuple[str, str]:
    """Sustituye la casilla de esa línea por una viñeta normal y devuelve (contenido, texto de la casilla)."""
    lines = content.split("\n")
    m = CHECKBOX.match(lines[line]) if line < len(lines) else None
    if not m or line not in [i for i, _, _ in extract_checklist(content)]:
        raise ValueError("La línea indicada no es una casilla")
    text = m.group(4).strip()
    indent = m.group(1)[: len(m.group(1)) - len(m.group(1).lstrip())]
    lines[line] = f"{indent}- {text} *(convertida en tarea)*"
    return "\n".join(lines), text


def rename_links(content: str, old: str, new: str) -> str:
    """Reescribe [[old]] → [[new]] conservando #sección y |alias."""
    old_l = old.lower()

    def repl(m: re.Match) -> str:
        if " ".join(m.group(1).split()).lower() != old_l:
            return m.group(0)
        return f"[[{new}{m.group(2) or ''}{m.group(3) or ''}]]"

    return WIKILINK.sub(repl, content)


def link_context(content: str, title: str, width: int = 160) -> str:
    t = title.lower()
    for _, line in prose_lines(content):
        for m in WIKILINK.finditer(line):
            if " ".join(m.group(1).split()).lower() == t:
                s = line.strip()
                return s if len(s) <= width else s[: width - 1] + "…"
    return ""


def snippet(content: str, query: str, width: int = 140) -> str:
    idx = content.lower().find(query.lower())
    if idx < 0:
        return " ".join(content[:width].split())
    start = max(0, idx - width // 3)
    chunk = " ".join(content[start : start + width].split())
    return ("…" if start else "") + chunk + ("…" if start + width < len(content) else "")
