import absorbed from './absorbed.js'
import dialog from './dialog.js'
import e18eNative from './e18e-native.generated.js'
import enterExit from './enter-exit.js'
import floatingUi from './floating-ui.js'
import polyfills from './polyfills.js'
import scrollAnimations from './scroll-animations.js'
import type { Rule } from '../types.js'

export const rules: Rule[] = [floatingUi, polyfills, absorbed, enterExit, dialog, scrollAnimations, e18eNative]
