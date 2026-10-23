# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report them privately through GitHub instead:

1. Go to the [Security tab](https://github.com/azammarchi/blipdeck/security) of this repository.
2. Click **Report a vulnerability**.
3. Describe the problem, how to reproduce it and what an attacker could do with it.

You'll get a reply as soon as possible. Once a fix is out, the report can be made public, with credit to you if you'd like.

## Supported versions

Only the latest version on the `main` branch (which is also what the [online demo](https://azammarchi.github.io/blipdeck/) runs) receives fixes.

## Scope

Blipdeck has no accounts and no online backend: the online demo keeps sounds in the visitor's browser, and the local app keeps them in a folder on the user's computer through a server that only listens on `localhost`. Nothing is ever uploaded. Relevant reports include, for example:

- a way for a crafted import file (`.json`) or audio file to run code or affect other data in the page;
- a way for one site or visitor to read or change another visitor's sounds;
- the local server (`server.js`) serving or writing files outside `public/` and `sounds/`, accepting requests from other sites or machines, or letting a web page change the saved sounds.
