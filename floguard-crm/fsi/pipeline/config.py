"""FSI scoring constants and pure math.

Source of truth: docs/FLOOD-SUSCEPTIBILITY-INDEX.md section 3.

These weights are literature defaults, NOT calibrated values. Recalibrate
w1..w6 and alpha by logistic regression once ~100 won/lost outcomes with
addresses exist. Never present an FSI value to a customer as a measurement.
"""

from __future__ import annotations

# --- Static term weights (sum to 1.0) ---
W_TWI = 0.40
W_HAND = 0.25
W_SOIL = 0.20
W_ZONE = 0.15

# --- Dynamic term weights (sum to 1.0) ---
W_API = 0.60
W_RAIN24 = 0.40

# Composite exponent. 1.0 until calibration says otherwise.
ALPHA = 1.0

# Daily decay for the Antecedent Precipitation Index.
API_DECAY_K = 0.87

# USDA hydrologic soil group -> risk contribution.
HSG_SCORE = {"A": 0.2, "B": 0.4, "C": 0.7, "D": 1.0}

# FEMA NFHL zone -> modifier. Deliberately compressed: FEMA maps riverine and
# coastal flood, FloGuard sells against groundwater and stormwater. Zone X with
# high TWI is the highest-value segment, so X never bottoms out near zero.
FEMA_ZONE_SCORE = {
    "AE": 1.0,
    "VE": 1.0,
    "AO": 0.8,
    "AH": 0.8,
    "X-SHADED": 0.6,
    "X": 0.45,
}

# Fallbacks when a parcel has no SSURGO or NFHL match. Mid-range on purpose:
# an unknown parcel should be neither promoted nor buried.
HSG_DEFAULT = 0.55
FEMA_ZONE_DEFAULT = 0.6


def hsg_score(hsg: str | None) -> float:
    """Map a hydrologic soil group to 0-1.

    SSURGO emits dual groups ('A/D', 'B/D') for soils whose rating depends on
    drainage. Those are the drained/undrained pair; take the wetter half, since
    an undrained yard is exactly the condition being scored.
    """
    if not hsg:
        return HSG_DEFAULT
    key = hsg.strip().upper()
    if "/" in key:
        key = key.split("/")[-1]
    return HSG_SCORE.get(key, HSG_DEFAULT)


def zone_score(zone: str | None) -> float:
    """Map a FEMA NFHL zone label to 0-1."""
    if not zone:
        return FEMA_ZONE_DEFAULT
    return FEMA_ZONE_SCORE.get(zone.strip().upper(), FEMA_ZONE_DEFAULT)


def static_score(twi_n: float, hand_n: float, hsg: str | None, zone: str | None) -> float:
    """S = w1*TWI_n + w2*(1 - HAND_n) + w3*HSG + w4*Z

    twi_n  normalized 0-1 across the county.
    hand_n normalized 0-1 raw HAND. Inversion happens HERE, once, so the stored
           column stays a plain normalized height and is not double-flipped.
    """
    return (
        W_TWI * twi_n
        + W_HAND * (1.0 - hand_n)
        + W_SOIL * hsg_score(hsg)
        + W_ZONE * zone_score(zone)
    )


def dynamic_score(api_n: float, rain24_n: float) -> float:
    """D = w5*API_n + w6*Rain24_n. Both inputs normalized 0-1."""
    return W_API * api_n + W_RAIN24 * rain24_n


def composite_fsi(s: float, d: float, alpha: float = ALPHA) -> float:
    """FSI = 100 * S^alpha * (0.5 + 0.5*D)

    Multiplicative on purpose. Rain on a well-drained ridge produces nothing;
    the same rain on a clay bowl floods. An additive model would rank a flat
    sandy ridge as high risk after a big storm and burn dials on it.

    The (0.5 + 0.5*D) form floors a bad-terrain parcel at half its static score
    during a dry spell -- the drainage defect is still there, it is just not
    currently being demonstrated.
    """
    return 100.0 * (s ** alpha) * (0.5 + 0.5 * d)


def advance_api(prev_api: float, rain_today: float) -> float:
    """API_t = k * API_(t-1) + P_t

    This is the term most implementations omit, and it is why the second storm
    floods a yard when the first did not: the soil never dried out.
    """
    return API_DECAY_K * prev_api + rain_today
