# Sprite Machine

Draw an object from the front, the side and the top with pixel-art tools,
and Sprite Machine turns the drawings into a blocky 3D model. Spin it around,
save it for a game engine, or turn it into a sprite atlas: a sheet of the
object seen from every angle.

Use it at <https://aportilla.github.io/sprite-machine/>. It runs in your
browser, saves your work there, and sends nothing anywhere.

![The Car sample, and the model built from its faces](docs/car.png)

The app looks and works like a classic Macintosh desktop: a menu bar, icons,
folders, a Trash and windows you drag around.

- [Quick start](#quick-start)
- [How a model is built](#how-a-model-is-built)
- [Drawing](#drawing)
- [Selecting and moving](#selecting-and-moving)
- [Layers](#layers)
- [Saving and files](#saving-and-files)
- [Exporting](#exporting)
- [The desktop](#the-desktop)
- [Fixing common problems](#fixing-common-problems)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [For developers](#for-developers)

Keys are written the Mac way. On Windows and Linux, press Ctrl for both ⌘
and ⌃, and Alt for Option. ⇧ is Shift. Two keys belong to the browser there,
⌃N and ⌃W, so use the File menu for New and Close.

## Quick start

1. Open the app. A welcome dialog appears. Click **OK**. You are on the
   desktop: three sample documents, **Car**, **Truck** and **Cube**, two
   read-me files and the Trash.
2. Double-click **Car**. Its window opens, showing the car's left side. Four
   small windows appear around it. They have no titles, so this guide names
   them by what they hold:
   - **Tools**, top left: six tool buttons.
   - **Color Palette**, under Tools: every color in the drawing.
   - **Full Sprite View**, top right: the car's six faces in a row.
   - **3D View**, under it: the model. It changes as you draw.
3. The pencil is already selected. Draw on the car. The 3D View changes with
   every stroke. Press ⌘Z to undo.
4. Check **rotate** at the top of the 3D View to spin the model.
5. Click another face in the Full Sprite View, such as the top, and draw on
   that. The line at the bottom of the document window names the face you
   are on.
6. Press ⌘S to save.

That is the whole loop: draw the faces, watch the model, save. To start a
blank document instead of the Car, choose **File → New…** (⌃N); see
[Saving and files](#saving-and-files).

## How a model is built

### The six faces

A document is one object drawn from six directions, one face each:
**Front**, **Back**, **Left**, **Right**, **Top** and **Bottom**. Left and
right are the object's own left and right. Each face is a square pixel
drawing. The document window shows one face at a time, and the line at the
bottom of the window names it.

To switch faces, click a face in the **Full Sprite View**. The row runs Left,
Right, Front, Back, Top, Bottom, and above each face sits a small cube with
that side marked. Clicking the cube works too.

Draw each face as you would see it standing there:

- **Front** and **Back**: head-on, upright.
- **Left** and **Right**: from that side. The object's front points left on
  the Left face and right on the Right face.
- **Top**: from above, with the object's front at the top of the square and
  its right side on the right.
- **Bottom**: from below, with the front at the top of the square.

### How the faces combine

Sprite Machine builds the model as if carving a block. The Front face cuts
away everything outside its outline. The side face cuts away more, and the
Top face more still. What is left is the model, painted in your colors, one
small cube for every pixel.

So the faces have to agree. If the car is 14 pixels long in the Left face, it
must be 14 pixels long in the Top face. Its height must match in the Front
and Left faces. A pixel missing from one face cuts a hole through the model,
and a pixel that the other faces do not have does nothing. The app helps you
keep faces in line; see [Lining up faces](#lining-up-faces).

### Which faces to draw

You do not have to draw all six. A face you leave empty is filled in from its
opposite, mirrored. If a face and its opposite are both empty, nothing is
cut from that direction. Most objects need only the Front, one side face and
the Top; the Cube sample is drawn that way. Draw the Back or the Right only
when they differ from the Front or the Left.

A document with only the Front drawn makes a model one pixel thick. Add a
side face or the Top to give it depth.

### Slopes and sharp edges

A step in the model becomes a smooth slope when both sides of the step are
the same color. One side of a step is painted from one face and the other
side from the face at right angles to it. A windshield steps up the front of
a car, so its steps are painted from the Front and from the Top. Give the
glass the same color in both faces and the windshield becomes a slope. Where
the two colors differ, the edge stays sharp, so a roof keeps a crisp edge
against the windows as long as they are different colors.

### Parts that need their own layer

Carving can only remove what some face shows as empty. If a gap is hidden in
every face, it fills in. Wheels under a car are the usual example. In the
Front face, the body comes down to the height of the wheels, so the space
between the left and right wheels is hidden behind it. No face shows that
space, so the model fills it in and the two wheels become one wide block.
Draw the wheels on their own layer, and that layer's Front face shows the
gap, so it stays open. See [Layers](#layers). The Truck sample is built from
six layers.

## Drawing

### The tools

Pick a tool in the **Tools** window, in the Tools menu, or with its key. The
bar under the menu bar shows the tool's settings.

| Tool       | Key | What it does                                                                                 |
| ---------- | --- | -------------------------------------------------------------------------------------------- |
| Selection  | S   | Selects the pixels inside a box you drag. See [Selecting and moving](#selecting-and-moving). |
| Pencil     | B   | Draws with the current color. Settings: a circle or square tip, and its size.                |
| Rectangle  | R   | Draws a filled box as you drag. Shift keeps it square. Setting: the corner radius.           |
| Fill       | G   | Fills the area you click with the current color.                                             |
| Eraser     | E   | Erases. Settings: tip shape and size.                                                        |
| Eyedropper | I   | Picks up the color of the pixel you click. On an empty spot, it switches to the eraser.      |

- With the pencil, rectangle or fill, hold the right mouse button to erase
  instead.
- Hold Option and click a pixel to pick up its color without leaving your
  tool. While you hold Option, the Tools window shows the eyedropper.
- The fill has two checkboxes. **contiguous** is on to start, so the fill
  stops at the edge of the area you click. Turn it off to recolor every
  pixel of that color on the face. The second, **on all faces**, then
  recolors it on all six faces at once.

### Colors

The current color is the swatch at the left of the bar under the menu bar.
To change it:

- Click the swatch. The **Colors** dialog opens with 168 named colors and a
  box for a hex code such as `#ff8800`. Click **OK**.
- Click a color in the **Color Palette** window. It shows every color already
  in the document, and the current one has a ring around it.
- Use the eyedropper, or Option-click a pixel with any tool. It works on
  the strips along the edges as well as on your drawing.

There is no palette import. New colors come from the Colors dialog, or from
an image you paste in. Pixels are either fully solid or fully clear; there is
no partial transparency.

### Lining up faces

While you draw one face, the canvas shows two helpers:

- **The faint picture behind your drawing** is the opposite face, mirrored,
  along with anything on the other layers. Draw over it to keep the two
  faces the same size.
- **The strips along the four edges** show where the neighboring faces have
  pixels. On the Front face, the strip on the left is the front edge of the
  Left face, and the strip on top is the front edge of the Top face. Line
  your pixels up with them. The eyedropper picks up their colors too.

### Undo

**Edit → Undo** (⌘Z) and **Redo** (⇧⌘Z) step through your last 50 changes.
Each stroke, fill, move, paste or flip is one change.

### Tile size

The tile size is the width and height of each face in pixels, from 1 to 64.
Pick one that fits your object's longest side. A car 32 pixels long and 14
high needs a tile of at least 32, and the rest of the square stays empty. A
new document starts at 40, which is what the Car and Truck use. A bigger
tile means more cubes and more detail.

**Edit → Tile Size…** changes it. Your drawing stays in the middle, and every
layer changes with it.

## Selecting and moving

With the selection tool (S), drag a box around some pixels. Then:

- **Move** them by dragging inside the box. Hold Shift to move in a straight
  line. Clear pixels in the selection do not cover what is under them.
- **Flip** them with **Flip Horizontal** and **Flip Vertical** in the bar
  under the menu bar.
- **Delete** them with Delete or Backspace.
- **Copy** (⌘C) and **Paste** (⌘V) them from the Edit menu. Pasted pixels
  arrive selected, so you can drag them into place. Paste again for another
  copy.
- **Select all** of the face with ⌘A.
- **Let go** with Esc or a click outside the box. Pixels moved off the edge
  are lost, and Undo brings them back.

Switching to another tool, face or layer also lets go of the selection.

Copy puts the pixels on the clipboard as a PNG, so you can paste them into
another program. Paste takes an image from any program and drops it in the
middle of the face. Partly transparent pixels become solid or clear.

A move changes only the face you are on. If you move the car up in the Front
face, move it up in the side faces too.

## Layers

A document can have up to eight layers. Each layer is its own set of six
faces and builds its own shape. The document's model is all the layers
together. Use a layer for a part that would get joined to the rest if drawn
with it: wheels under a car, a hat on a head, a handle on a mug. Where layers
overlap, the colors of the layer lower in the Layer menu's list show.

The Layer menu:

- **New Layer…** (⌘K) asks for a name, then adds an empty layer and switches
  to it. The name starts as Layer 2, Layer 3 and so on.
- **Delete Layer**, **Rename Layer…**, **Move Layer Up** and **Move Layer
  Down** act on the layer you are editing.
- The list at the bottom of the menu switches layers. So do the keys 1 to 8.
  A popup at the bottom of the document window switches layers too; it
  appears once a document has two layers.

While you edit a layer, the other layers show faintly behind your drawing.
Check **single layer** at the top of the 3D View to see only the layer you
are editing.

To copy a face from one layer to another:

1. Press ⌘A, then ⌘C.
2. Press the number of the other layer.
3. Press ⌘V. The pixels land in the same place, selected.

## Saving and files

Your documents are the icons on the desktop. They are saved in your browser,
not on your disk and not on any server. If the browser's storage for the site
is cleared, they go with it, so keep a copy of anything you care about with
[Download](#download-and-back-up).

**New.** Choose **File → New…** (⌃N) in a document, or **File → New Sprite**
on the desktop; they are the same command. A name is offered; keep it or type
your own. Pick a template, **Empty Document** or a copy of Car, Truck or
Cube, and click **OK**. For an empty document you set the tile size; a
template keeps its own. The document opens, but it is not on the desktop
until you save it.

**Open.** Double-click a document's icon. Several documents can be open at
once. There is no Open command.

**Save.** Choose **File → Save** (⌘S). The first save asks you to confirm the
name, and the document's icon appears on the desktop. A document that has
never been saved is lost if you reload the page, so save early. The browser
warns you before you leave with unsaved changes.

**Rename.** Choose **File → Rename…**, or select the icon and press Return.

**Duplicate.** Choose **File → Duplicate** (⌘D). A copy called "Car copy" is
saved beside the original and opens in its own window.

**Close and Quit.** Choose **File → Close** (⌃W) to close a document. If it
has unsaved changes, a dialog asks whether to save them. **File → Quit** (⌃Q)
closes every open document the same way. These use the Control key because
the browser keeps ⌘N, ⌘W and ⌘Q for itself: ⌘W closes the browser tab.

### Download and back up

**File → Download** (⇧⌘E) saves the open document to your disk as a PNG
named after it, such as `car.png`. The file holds the drawing, its name, its
layers and its sprite atlas settings. Folders, icon positions and the desktop
pattern are not in it. Download works on one document at a time, so to back
up everything, open each document and download it.

To bring a file back, on any computer, drag it anywhere onto the page. It
opens in a window; press ⌘S to put it on the desktop. Drop one file at a
time.

A private browsing window cannot save, and the app says so when you try.
Everything else works there, and Download keeps your work.

### Open a document by link

`https://aportilla.github.io/sprite-machine/?file=Car` opens the saved
document called Car. Capitals do not matter.

### The PNG in other programs

Open a downloaded PNG in a paint program and you see the six faces in one
image, three across and two down:

```
Left   Front  Top
Right  Back   Bottom
```

A document with layers repeats the two rows once per layer, top to bottom.
Sprite Machine reads the tile size from the image's shape, so any PNG three
squares wide and two squares tall opens as a document when you drag it onto
the page. You can draw one in another program that way.

## Exporting

### A 3D model

**File → Export 3D Model…** saves a `.glb` file named after the document,
such as `car.glb`. Unity, Godot, Unreal, Blender, three.js and most 3D tools
open it, with the colors built in.

- **Scale** sets how big the model is in your game. The field reads "voxels
  per meter", and a voxel is the cube one pixel becomes. At the starting
  value of 10, a car 40 pixels long is 4 meters long.
- **Lighting**: **Lit** lets your game's lights shade the model. **Unlit**
  keeps your exact colors, flat, like the drawing.

The dialog also shows the model's triangle count and its size in meters.
Click **Export**.

Notes for whoever imports the file: the model's zero point is the middle of
the drawing area's floor, which is the middle of the model's base when it is
drawn centered and resting on the bottom row. Y points up, and the Front
face faces +Z. The colors are a small
image inside the file, its texture, set to draw sharp pixels. If a program
blurs them, turn off mipmaps for that image and set its filtering to nearest.
Unity needs this.

### A sprite atlas

For a 2D game, **File → Export Sprite Atlas…** draws the model from several
angles and saves the pictures in a row. A data file beside it tells your
engine where each picture is.

1. Choose **File → Export Sprite Atlas…**. The dialog has four settings:
   - **Views**: how many angles, 1 to 16, evenly spaced around the object.
   - **Elevation**: how far above the object the camera looks, 0 to 90
     degrees.
   - **First angle**: where the first picture is taken from, in degrees from
     the front.
   - **Size**: each picture's width and height in pixels, 2 to 255.
2. Click **Export**.

To see the pictures before you export, choose **View → 3D Sprite Atlas**. A
window opens showing the row, with the same four settings at the top, named
**views**, **elev**, **from** and **size**. Change them there or in the
dialog; they are the same numbers, and they are saved with the document.

The pictures start at the front and go around the object's right side to the
back and the left side. The whole drawing area is scaled to fit each
picture, so a small model in a large tile comes out small. The pictures are
drawn with hard edges, no smoothing. The defaults are 4 views, 45 degrees up, from
the front, 64 pixels.

You get a zip named after the document, such as `car-atlas.zip`, with two
files inside. `car-atlas.png` is the row of pictures on a transparent
background. `car-atlas.json` is a text file in the TexturePacker format, which
Phaser, PixiJS, Godot, Unity and others read. In it the pictures are called
`car-0`, `car-1` and so on, in order, and an animation called `car` plays
them through. Each picture's pivot is the middle of the drawing area's floor,
the same spot in every picture, so the sprite does not wobble as it turns.

## The desktop

Click the desktop, an icon or a folder and you leave the document: the small
windows hide, and the menu bar switches to the desktop's menus. Click a
document window to come back. Keys follow the front window; see
[Keyboard shortcuts](#keyboard-shortcuts).

### Icons

- **Open** a document, folder or read-me by double-clicking it. An open item's
  icon is drawn hollow.
- **Select** an icon by clicking it, or drag a box around several. Hold Shift
  while dragging to toggle icons in and out of the selection. ⌘A selects
  all.
- **Move** icons by dragging. Esc cancels the drag. **Special → Clean Up
  Desktop** lines them up.
- **Rename** an icon: select it, press Return and type.
- **Copy** (⌘C) and **Paste** (⌘V) icons to make copies. A copy pasted
  beside the original is called "Car copy", then "Car copy 2".

A document's icon is a small picture of its model, drawn each time you save.

### Folders and the Trash

- **File → New Folder** makes a folder. Drag icons onto it, or into its open
  window, to put them inside. Folders can go inside folders. In a folder
  window, **Special → Clean Up Window** lines up its icons, and ⌃W closes
  the window.
- **The Trash** is the can at the bottom right. Drag icons to it to delete
  them. Nothing is deleted until **Special → Empty Trash…**, which asks
  first. Before that, you can drag things back out.
- **Special → Restore Default Files** brings back any sample document or
  read-me that is gone, once the Trash has been emptied.

### Windows

- Drag a window by its title bar. Most windows resize from the box at their
  bottom-right corner; the Tools and Full Sprite View windows and the
  Desktop Patterns panel do not.
- Click the zoom box at the right end of a document window's title bar to
  grow it right and down into the free space, and again to put it back.
- **View → Arrange Windows** (⌘J) puts every window back where it started.
  In a document, when everything is already in place, it zooms the document
  window instead.
- In a document, the View menu lists the open documents. Pick one to bring
  it to the front.
- Window positions are not remembered between visits, except for folder
  windows.

### The Sprite Machine menu

- **About Sprite Machine…** shows the version. Uncheck **Show at startup**
  there if you would rather not see the dialog every time.
- **Desktop Patterns** opens a panel of 38 patterns. Click one to try it,
  then click **Set Desktop Pattern**. Closing the panel without clicking it
  keeps the old pattern. The app remembers your choice.

The clock at the right end of the menu bar shows the date when you click it.

### Read-me files

**Read Me** and **Keyboard Shortcuts** are text files on the desktop.
Double-click one to read it. You can rename, move, copy or trash them, and
they always show the text for the version of Sprite Machine you are running.
Select text with the mouse and copy it with ⌘C;
⌘A selects all of it. The zoom box widens the window into a reading column,
and ⌃W closes it.

## Fixing common problems

**There is a hole through the model.** One face is missing a pixel there.
Look through the six faces in the Full Sprite View for the one that does not
match, and fill it in.

**The model is flat.** Only one face is drawn. Draw a side face or the Top to
give it depth.

**A part vanished.** The model keeps only what every drawn face includes. A
part drawn in the Front and Left faces but left out of the Top face is cut
away by the Top. Add it to the face that lacks it.

**Two parts are joined by a block, or a gap filled in.** Put one of the parts
on its own layer. See [Layers](#layers).

**A slope instead of a step, or a step instead of a slope.** Both sides of a
step in one color make a slope; two colors keep the step. See
[Slopes and sharp edges](#slopes-and-sharp-edges).

**A face comes out turned or mirrored.** Check which way its front points.
See [The six faces](#the-six-faces).

**The model sits off to one side, or floats.** The model is wherever you drew
it. On each face, press ⌘A and drag the drawing into place.

**Something on its own layer is one pixel thick.** That layer has only one
face drawn. Give it a second face at right angles to the first.

**The app says storage is unavailable.** You are in a private window, or the
browser is blocking storage for the site. Use Download to keep your work.

**⌘W closed the tab.** The browser owns ⌘W, ⌘N and ⌘Q. Use ⌃W, ⌃N and ⌃Q,
or the File menu.

**Keys do nothing.** Keys go to the front window. Click the document window
first.

**Pasting a picture on the desktop says it isn't a sprite sheet.** On the
desktop, only a PNG in Sprite Machine's own layout becomes a document. See
[The PNG in other programs](#the-png-in-other-programs). To paste a picture
into a drawing, open a document and paste there.

**The colors blur in a game engine.** Turn off mipmaps on the model's texture
and set its filtering to nearest. See [A 3D model](#a-3d-model).

## Keyboard shortcuts

A key belongs to the menu it is on, so it works while that kind of window is
in front.

| Key         | In a document           | On the desktop          | In a read-me        |
| ----------- | ----------------------- | ----------------------- | ------------------- |
| ⌃N          | New…                    | New Sprite              |                     |
| ⌃W          | Close the document      | Close the folder window | Close the read-me   |
| ⌃Q          | Quit                    |                         | Close every read-me |
| ⌘S          | Save                    |                         |                     |
| ⌘D          | Duplicate               |                         |                     |
| ⇧⌘E         | Download                |                         |                     |
| ⌘Z, ⇧⌘Z     | Undo, Redo              |                         |                     |
| ⌘C, ⌘V, ⌘A  | Copy, Paste, Select All | The same, on icons      | Copy, Select All    |
| ⌘J          | Arrange Windows         | Arrange Windows         | Arrange Windows     |
| ⌘K          | New Layer…              |                         |                     |
| S B R G E I | The tools               |                         |                     |
| 1 to 8      | Edit that layer         |                         |                     |

| Mouse and modifiers | What they do                                                       |
| ------------------- | ------------------------------------------------------------------ |
| Double-click        | Open an icon                                                       |
| Return              | Rename the selected icon; in a dialog, the default button          |
| Right button        | Erase with the pencil, rectangle or fill                           |
| Option              | Pick up a color with any tool                                      |
| Shift               | Square a rectangle, move in a straight line, toggle icons in a box |
| Esc                 | Cancel a drag, let go of a selection, dismiss a dialog             |
| Delete              | Clear the selected pixels                                          |

## For developers

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit suites, both packages
npm run typecheck
npm run lint       # prettier --check (npm run format to fix)
npm run build      # static bundle in dist/
```

The part that turns the faces into a model is the npm package
`sprite-machine` in `packages/core`. Its [README](packages/core/README.md)
documents the API: `buildModel` and `modelToGlb`, a three.js adapter, a Node
entry and a `sprite-machine build` command line.

The app's behavior in full, window by window and rule by rule, is in
[docs/SPEC.md](docs/SPEC.md). The testing policy is
[docs/TESTING.md](docs/TESTING.md). Every push to `main` deploys the app to
GitHub Pages after the tests, lint, typecheck and build pass.
