/**
 * The game shades in display (sRGB) space like classic voxel games: texture
 * bytes, vertex tints and colour constants are used as-is and written out
 * unconverted. Disable three.js colour management before any THREE.Color is
 * created so hex constants are not converted to linear space.
 */
import * as THREE from 'three';

THREE.ColorManagement.enabled = false;
