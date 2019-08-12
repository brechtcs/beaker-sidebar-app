import { LitElement, html, TemplateResult } from '/vendor/beaker-app-stdlib/vendor/lit-element/lit-element.js'
import minimist from '/vendor/minimist.1.2.0.js'
import { joinPath } from '/vendor/beaker-app-stdlib/js/strings.js'
import terminalCSS from '../../css/views/terminal.css.js'

class WebTerm extends LitElement {
  static get properties () {
    return {
      url: {type: String}
    }
  }

  static get styles () {
    return [terminalCSS]
  }

  constructor () {
    super()
    this.isLoaded = false
    this.url = ''
    this.env = null
    this.cwd = null
    this.outputHist = []

    this.builtins = {
      html,
      evalCommand: this.evalCommand.bind(this),
      getCWD: () => this.cwd,
      setCWD: this.setCWD.bind(this),
      getHome: () => 'dat://pfrazee.com', // TODO
      browser: {
        goto: url => beaker.browser.gotoUrl(url),
        openSidebar: panel => beaker.browser.openSidebar(panel),
      }
    }

    this.commandHist = {
      array: new Array(),
      insert: -1,
      cursor: -1,
      add (entry) {
        if (entry) {
          this.array.push(entry)
        }
        this.cursor = this.array.length
      },
      prevUp () {
        if (this.cursor === -1) return ''
        this.cursor = Math.max(0, this.cursor - 1)
        return this.array[this.cursor]
      },
      prevDown () {
        this.cursor = Math.min(this.array.length, this.cursor + 1)
        return this.array[this.cursor] || ''
      },
      reset () {
        this.cursor = this.array.length
      }
    }

    this.addEventListener('click', () => this.setFocus())
  }

  attributeChangedCallback (name, oldval, newval) {
    super.attributeChangedCallback(name, oldval, newval)
    if (name === 'url') {
      this.load()
    }
  }

  async load () {
    this.readCWD()
    await this.importEnvironment()
    await this.appendOutput(html`<div><strong>Welcome to webterm 1.0.</strong> Type <code>help</code> if you get lost.</div>`, this.cwd.pathname)
    this.setFocus()
    this.requestUpdate()
  }

  async importEnvironment () {
    try {
      var module = await import('/js/lib/term-default-env.js')
      var env = Object.assign({}, module)
      for (let k in this.builtins) {
        Object.defineProperty(env, k, {value: this.builtins[k], enumerable: false})
      }
      this.env = env
      console.log('Environment', env)
    } catch (err) {
      console.error(err)
      return appendError('Failed to evaluate environment script', err, this.cwd)
    }
  }

  async setCWD (location) {
    var locationParsed
    try {
      locationParsed = new URL(location)
      location = `${locationParsed.host}${locationParsed.pathname}`
    } catch (err) {
      location = `${this.cwd.host}${joinPath(this.cwd.pathname, location)}`
    }
    locationParsed = new URL('dat://' + location)

    // make sure the destination exists
    let archive = new DatArchive(locationParsed.host)
    let st = await archive.stat(locationParsed.pathname)
    if (!st.isDirectory()) {
      throw new Error('Not a directory')
    }

    this.url = location
    this.readCWD()
  }

  parseURL (url) {
    if (!url.startsWith('dat://')) url = 'dat://' + url
    let urlp = new URL(url)
    let host = url.slice(0, url.indexOf('/'))
    let pathname = url.slice(url.indexOf('/'))
    let archive = new DatArchive(urlp.hostname)
    return {url, host: urlp.hostname, pathname: urlp.pathname, archive}
  }

  readCWD () {
    this.cwd = this.parseURL(this.url)
    console.log('CWD', this.cwd)
  }

  appendOutput (output, thenCWD, cmd) {
    if (typeof output === 'undefined') {
      output = 'Ok.'
    } else if (output.toHTML) {
      output = output.toHTML()
    } else if (typeof output !== 'string' && !(output instanceof TemplateResult)) {
      output = JSON.stringify(output).replace(/^"|"$/g, '')
    }
    thenCWD = thenCWD || this.cwd
    this.outputHist.push(html`
      <div class="entry">
        <div class="entry-header">${shortenHash(thenCWD.host)}${thenCWD.pathname}&gt; ${cmd || ''}</div>
        <div class="entry-content">${output}</div>
      </div>
    `)
    this.requestUpdate()
  }
  
  appendError (msg, err, thenCWD, cmd) {
    this.appendOutput(
      html`<div class="error"><div class="error-header">${msg}</div><div class="error-stack">${err.toString()}</div></div>`,
      thenCWD,
      cmd
    )
  }
  
  clearHistory () {
    this.outputHist = []
    this.requestUpdate()
  }

  parseCommand (str) {
    // parse the command
    var parts = str.split(' ')
    var cmd = parts[0]
    var argsParsed = minimist(parts.slice(1))
    console.log(JSON.stringify(argsParsed))

    // form the js call
    var args = argsParsed._
    delete argsParsed._
    args.unshift(argsParsed) // opts always go first

    return `this.env['${cmd}'](this.env, ${args.map(JSON.stringify).join(', ')})`
  }

  evalPrompt () {
    var prompt = this.shadowRoot.querySelector('.prompt input')
    if (!prompt.value.trim()) {
      return
    }
    this.commandHist.add(prompt.value)
    this.evalCommand(prompt.value)
    prompt.value = ''
  }
  
  async evalCommand (command) {
    try {
      var res
      var oldCWD = Object.assign({}, this.env.getCWD())
      var codeToEval = this.parseCommand(command)
      res = await eval(codeToEval)
      this.appendOutput(res, oldCWD, command)
    } catch (err) {
      if (err.toString() === `TypeError: this.env.${command} is not a function`) {
        err = `Invalid command: ${command}`
      }
      this.appendError('Command error', err, oldCWD, command)
    }
  }

  setFocus () {
    this.shadowRoot.querySelector('.prompt input').focus()
  }

  // rendering
  // =

  render () {
    return html`
      <div class="wrapper" @keydown=${this.onKeyDown}>
        <div class="output">
          ${this.outputHist}
        </div>
        <div class="prompt">
          ${shortenHash(this.cwd.host)}${this.cwd.pathname}&gt; <input @keyup=${this.onPromptKeyUp} />
        </div>
      </div>
    `
  }

  updated () {
    this.scrollTo(0, this.clientHeight)
  }

  // events
  // =

  onKeyDown (e) {
    this.setFocus()
    if (e.code === 'KeyL' && e.ctrlKey) {
      e.preventDefault()
      this.clearHistory()
    } else if (e.code === 'ArrowUp' || (e.code === 'KeyP' && e.ctrlKey)) {
      e.preventDefault()
      this.shadowRoot.querySelector('.prompt input').value = this.commandHist.prevUp()
    } else if (e.code === 'ArrowDown' || (e.code === 'KeyN' && e.ctrlKey)) {
      e.preventDefault()
      this.shadowRoot.querySelector('.prompt input').value = this.commandHist.prevDown()
    } else if (e.code === 'Escape') {
      e.preventDefault()
      this.shadowRoot.querySelector('.prompt input').value = ''
      this.commandHist.reset()
    }
  }
  
  onPromptKeyUp (e) {
    if (e.code === 'Enter') {
      this.evalPrompt()
    }
  }
}

customElements.define('web-term', WebTerm)

// helpers
//

function shortenHash (str = '') {
  return str.replace(/[0-9a-f]{64}/ig, v => `${v.slice(0, 6)}..${v.slice(-2)}`)
}