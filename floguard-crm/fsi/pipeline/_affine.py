"""Version-agnostic affine helpers (affine 3 deprecates `*` composition; 2.x lacks some `@` forms)."""
from affine import Affine


def apply(t: Affine, x, y):
    """Map (col, row) -> (x, y) with t, or (x, y) -> (col, row) with ~t. Works on arrays."""
    return t.a * x + t.b * y + t.c, t.d * x + t.e * y + t.f


def translate(t: Affine, cols, rows) -> Affine:
    """t then shift by (cols, rows) cells: the transform of a sub-window."""
    return Affine(t.a, t.b, t.c + t.a * cols + t.b * rows, t.d, t.e, t.f + t.d * cols + t.e * rows)


def scale(t: Affine, s: float) -> Affine:
    """Cells s times smaller/larger (s=1/4 -> 4x supersampled grid)."""
    return Affine(t.a * s, t.b * s, t.c, t.d * s, t.e * s, t.f)
