// dsh-screenshot — Host half (static / composition plugin)
//
// This plugin is almost entirely browser-side: the button, the region picker
// and the attachment intake all live in ./client.js, which the DSH boot graph
// serves to the Web shell because this package declares `dsh.client`.
//
// The host half therefore has no runtime behaviour of its own. It exists so
// the composition (cordis.patch.yml) can load the package as a normal plugin
// row, which is what makes the client half part of the boot graph at all.
//
// Keep it inert: no services claimed, no events, nothing that can fail and
// take the composer down with it.
import { Service } from '@deepseek-ai/cordis'

/** Plugin id used by the composition row and by the client bundle. */
export const PLUGIN = 'dsh-screenshot'

export class ScreenshotPlugin extends Service {
  /** No host dependencies: the whole feature is browser-side. */
  static inject = []

  constructor(ctx) {
    super(ctx, 'dshScreenshot')
  }
}

export default ScreenshotPlugin
