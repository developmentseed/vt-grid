
This isn't a "real" benchmark setup -- just a use case for vt-grid that's
somewhat slow at the moment, capturing it here for investigation and maybe later
making into something more systematic.

Context: https://github.com/hotosm/oam-catalog-grid

Check it:
```sh
npm install -g node-debug
node-debug footprints.js
```

Start the CPU profiler, wait a while, stop it, and poke around.

