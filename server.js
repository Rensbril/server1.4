// these settings can be changed for testing purposes
const VERSION = "1.4"
const PORT = 1337
const BIND_ADDRESS = "127.0.0.1" // use '0.0.0.0' to accept remote connections, e.g. on VPS
const SHOULD_PING = true
const PING_FREQ_MS = 10_000
const PING_TIMEOUT_MS = 3_000
const MAX_PENDING = 1024

import net from "net"

const server = net.createServer((socket) => {
  // accept socket connection from new client
  clients.add(new Client(socket))
})

console.log(`Starting server version ${VERSION} on port ${PORT}`)
console.log("Press Ctrl-C to quit the server")
server.listen(PORT, BIND_ADDRESS)

// level 1 commands
const CMD_BROADCAST = "BCST"
const CMD_CONFIRM = "OK"
const CMD_DISCONNECT = "DSCN"
const CMD_INIT = "INIT"
const CMD_LOGIN = "IDENT"
const CMD_PING = "PING"
const CMD_PONG = "PONG"
const CMD_QUIT = "QUIT"

// error messages
const FAIL00 = "FAIL00 Unknown command"
const FAIL01 = "FAIL01 User already logged in"
const FAIL02 = "FAIL02 Username has an invalid format or length"
const FAIL03 = "FAIL03 Please log in first"
const FAIL04 = "FAIL04 User cannot login twice"
const FAIL05 = "FAIL05 Pong without ping"

// match a line of text, including the line separator character(s)
const LINE = /([^\n\r]*)(?:\r\n|\r|\n)/g //follows the rules of Java BufferedReader.readLine()
// test validity of username
const USERNAME = /^[A-Z0-9_]{3,14}$/i

// all clients
const clients = new Set()
// map unique user names to clients
const users = Object.create(null)

/**
 * @param {string} message
 * @returns {[string, string]} command and payload
 */
function parseMessage(message) {
  const command = message.split(" ", 1)[0]
  return [command, message.substring(command.length + 1)]
}

function printStats() {
  console.log(`${clients.size} client(s) / ${Object.keys(users).length} user(s)`)
}

// client object encapsulates socket connection with a client
class Client {
  // socket connection with client
  #socket
  // unique user name (empty if client hasn't been identified yet)
  #username
  // pending data has not yet been processed
  #pending
  // (interval) timer to initiate heartbeat
  #pingTimer
  // timer to detect PONG timeout (nonzero if timer is running)
  #pongTimer
  /**
   * @param {net.Socket} socket
   */
  constructor(socket) {
    this.#socket = socket
    this.#username = ""
    this.#pending = ""
    this.#pingTimer = 0
    this.#pongTimer = 0
    // send and receive UTF-8 strings
    socket.setEncoding("utf8")
    // install event handlers
    socket.on("close", this.#handleCloseEvent.bind(this))
    socket.on("data", this.#handleDataEvent.bind(this))
    socket.on("end", this.#handleEndEvent.bind(this))
    socket.on("error", this.#handleErrorEvent.bind(this))
    // server starts with INIT message
    this.#sendMessage(`${CMD_INIT} Welcome to the server ${VERSION}`)
  }
  get #remoteConnection() {
    const { remoteAddress, remotePort } = this.#socket
    return remoteAddress ? `${remoteAddress}:${remotePort}` : ""
  }
  /**
   * @param {string} text
   */
  #log(text) {
    console.log(`${this.#remoteConnection} (${this.#username}) ${text}`)
  }
  /**
   * @param {boolean} hadError
   */
  #handleCloseEvent(hadError) {
    if (hadError) {
      this.#log("closing connection due to transmission error")
    }
    // clean up when client resources
    clearInterval(this.#pingTimer)
    clearTimeout(this.#pongTimer)
    delete users[this.#username]
    clients.delete(this)
    this.#log("removed client")
    printStats()
  }
  /**
   * @param {string} data
   */
  #handleDataEvent(data) {
    let unprocessed = 0
    this.#pending += data
    for (const match of this.#pending.matchAll(LINE)) {
      // first group captures a single line, without the line separator characters
      this.#processMessage(match[1])
      // advance to start of next line, skipping over line separator characters
      unprocessed = match.index + match[0].length
    }
    // keep unprocessed data as pending for next data event
    this.#pending = this.#pending.substring(unprocessed)
    // avoid denial-of-service by exhausting memory
    if (this.#pending.length > MAX_PENDING) {
      this.#log("too many pending characters")
      this.#sendMessage(`${CMD_DISCONNECT} Unterminated message`)
      this.#socket.destroy()
    }
  }
  #handleEndEvent() {
    this.#log("client closed connection unexpectedly")
    this.#socket.destroy()
  }
  /**
   * @param {Error} error
   */
  #handleErrorEvent(error) {
    this.#log(error.stack ?? error.message)
  }
  /**
   * @param {string} message
   */
  #sendMessage(message) {
    this.#log(`<-- ${message}`)
    // write message with trailing line separator
    this.#socket.write(`${message}\n`)
  }
  /**
   * @param {string} message
   */
  #processMessage(message) {
    this.#log(`--> ${message}`)
    const [command, payload] = parseMessage(message)
    switch (command) {
      case CMD_BROADCAST:
        this.#processBroadcast(payload)
        break
      case CMD_LOGIN:
        this.#processLogin(payload)
        break
      case CMD_PONG:
        this.#processPong(payload)
        break
      case CMD_QUIT:
        this.#processQuit(payload)
        break
      default:
        this.#sendMessage(FAIL00)
    }
  }
  /**
   * @param {string} payload
   */
  #processLogin(payload) {
    if (this.#username) {
      // cannot login twice
      this.#sendMessage(FAIL04)
    } else if (!USERNAME.test(payload)) {
      // username must be syntactically valid
      this.#sendMessage(FAIL02)
    } else if (users[payload]) {
      // username already used by other client
      this.#sendMessage(FAIL01)
    } else {
      this.#username = payload
      users[payload] = this
      if (SHOULD_PING) {
        this.#startHeartbeat()
      }
      this.#sendMessage(`${CMD_CONFIRM} ${CMD_LOGIN} ${payload}`)
      printStats()
    }
  }
  /**
   * @param {string} payload
   */
  #processBroadcast(payload) {
    if (!this.#username) {
      // need to login first
      this.#sendMessage(FAIL03)
    } else {
      for (const username in users) {
        if (username == this.#username) {
          // confirm broadcast to this user
          this.#sendMessage(`${CMD_CONFIRM} ${CMD_BROADCAST} ${payload}`)
        } else {
          // broadcast from this user to other user
          users[username].#sendMessage(`${CMD_BROADCAST} ${this.#username} ${payload}`)
        }
      }
    }
  }
  /**
   * @param {string} payload
   */
  #processQuit(_payload) {
    this.#sendMessage(`${CMD_CONFIRM} Goodbye`)
    this.#socket.destroy()
  }
  /**
   * @param {string} payload
   */
  #processPong(_payload) {
    if (!this.#pongTimer) {
      this.#sendMessage(FAIL05)
    } else {
      this.#log("heartbeat success")
      clearTimeout(this.#pongTimer)
      // reset timer after clearing
      this.#pongTimer = 0
    }
  }
  #startHeartbeat() {
    this.#log("hearbeat initiated")
    this.#pingTimer = setInterval(() => {
      this.#sendMessage(`${CMD_PING}`)
      this.#pongTimer = setTimeout(() => {
        this.#log("heartbeat failure")
        this.#sendMessage(`${CMD_DISCONNECT} Pong timeout`)
        this.#socket.destroy()
      }, PING_TIMEOUT_MS)
    }, PING_FREQ_MS)
  }
}
