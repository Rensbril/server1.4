# README

This is the level 1 implementation of the server for the module internet technology.

To run the server make sure to install the latest version of nodejs:
https://nodejs.org/en/download/

Open the command line terminal and type:
```
$ node sever.js
```

The connection to the server can be tested using netcat. Open a new command line terminal (while the server is running) and type:

```
$ nc 127.0.0.1 1337
INIT Welcome to the server 1.2
IDENT Alice
OK IDENT Alice
QUIT
OK Goodbye
```

## Parameters

The server.js has two parameters that can be changed for development purposes:

- PORT: the port on which the server listens (default port 1337 is used)
- SHOULD_PING: a boolean which determines whether the server should send a PING periodically (default is true). When starting the development of the client it is useful to set it to false in order to keep the connection open.
