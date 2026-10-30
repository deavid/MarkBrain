/**
 * Re-export shim (Phase 3): the implementation moved to shared/colors.ts so
 * the turn-commit planner can use it without shared/ importing from src/.
 * Every existing import path keeps working.
 */
export { MELLOW_DARK_PASTELS, getMellowPastelColor } from '../../shared/colors';
