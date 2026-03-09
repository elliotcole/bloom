# bloom

Bloom is a model for a musical object that can be transformed. It is a general tool that can be used in computer-aided composition, generative music, live coding, building interactive systems, and more. I developed it for my personal use, and it is the subject of my PhD dissertation "Composing with Blooms."

## Repository Structure

- **`supercollider/`** — The original SuperCollider implementation
- **`web/`** — A web-based version built with TypeScript
- **`dissertation/`** — PhD dissertation: "Composing with Blooms"

---

## SuperCollider

### Installation
1. Download or clone this repository
2. If you don't have SuperCollider, download it from https://supercollider.github.io and drag it to your Applications folder
3. In SuperCollider: File Menu > Open User Support Directory
4. Copy the `supercollider/Bloom` folder into the `Extensions` folder in that directory (create it with a capital E if it doesn't exist)

### Usage
- To read the helpfile, type `Bloom` into a SuperCollider document and press Command-D
- The Keystroke Controller is the easiest way to work with Blooms — open `supercollider/Tools/bloom keystroke controller.scd` and run it
- To run a block of code in SuperCollider, click inside a parenthesized area and press Command-Enter

---

## Web Version

A browser-based implementation of Bloom built with TypeScript and Vite.

### Setup
```
cd web
npm install
npm run dev
```
