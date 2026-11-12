"""Press keys the way a keyboard does, through the X server (XTest), for the end-to-end tests on Linux.

Playwright's key presses go to the page through the DevTools protocol, so they never meet what Windows and X do with a
real key first: a key another program registered everywhere (Electron's globalShortcut) and the app menu's own keys
(Edit › Undo is Ctrl+Z). This sends the key to the X server instead, as a keyboard would.

    python3 osKeys.py [--elsewhere] [--click X,Y] KEY...   KEY: "F9", "Control_L+z", "Shift_L+Escape" (X key names)

--elsewhere first gives the keyboard to a small window of its own, so the app does not have it (another program is in
front), and closes that window afterwards. --click X,Y first clicks the left mouse button there (screen pixels), as a
person clicks into the app before pressing keys. Exit code 2 when there is no X server or no XTest.
"""
import ctypes
import ctypes.util
import sys
import time


def load(name):
    path = ctypes.util.find_library(name) or f"lib{name}.so.6"
    try:
        return ctypes.cdll.LoadLibrary(path)
    except OSError:
        return None


def main(argv):
    elsewhere = "--elsewhere" in argv
    click = None
    if "--click" in argv:
        at = argv.index("--click")
        click = [int(n) for n in argv[at + 1].split(",")]
        argv = argv[:at] + argv[at + 2:]
    keys = [a for a in argv if a != "--elsewhere"]
    x11, xtst = load("X11"), load("Xtst")
    if not x11 or not xtst:
        print("No X11 or XTest library", file=sys.stderr)
        return 2
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XStringToKeysym.restype = ctypes.c_ulong
    x11.XStringToKeysym.argtypes = [ctypes.c_char_p]
    x11.XKeysymToKeycode.restype = ctypes.c_ubyte
    x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    x11.XDefaultRootWindow.restype = ctypes.c_ulong
    x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
    x11.XCreateSimpleWindow.restype = ctypes.c_ulong
    x11.XCreateSimpleWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong] + [ctypes.c_int] * 2 + [ctypes.c_uint] * 3 + [ctypes.c_ulong] * 2
    for name in ("XMapRaised", "XDestroyWindow"):
        getattr(x11, name).argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    x11.XSetInputFocus.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
    x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
    xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
    xtst.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
    xtst.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
    display = x11.XOpenDisplay(None)
    if not display:
        print("No X server (DISPLAY)", file=sys.stderr)
        return 2
    window = 0
    if elsewhere:
        window = x11.XCreateSimpleWindow(display, x11.XDefaultRootWindow(display), 0, 0, 40, 40, 0, 0, 0)
        x11.XMapRaised(display, window)
        x11.XSync(display, 0)
        time.sleep(0.2)
        x11.XSetInputFocus(display, window, 2, 0)  # RevertToParent, CurrentTime
        x11.XSync(display, 0)
        time.sleep(0.2)
    if click:
        xtst.XTestFakeMotionEvent(display, -1, click[0], click[1], 0)
        x11.XSync(display, 0)
        time.sleep(0.1)
        xtst.XTestFakeButtonEvent(display, 1, 1, 0)
        x11.XSync(display, 0)
        time.sleep(0.05)
        xtst.XTestFakeButtonEvent(display, 1, 0, 0)
        x11.XSync(display, 0)
        time.sleep(0.3)
    for key in keys:
        codes = []
        for part in key.split("+"):
            code = x11.XKeysymToKeycode(display, x11.XStringToKeysym(part.encode()))
            if not code:
                print(f"Unknown key: {part}", file=sys.stderr)
                return 1
            codes.append(code)
        for code in codes:
            xtst.XTestFakeKeyEvent(display, code, 1, 0)
            x11.XSync(display, 0)
            time.sleep(0.03)
        for code in reversed(codes):
            xtst.XTestFakeKeyEvent(display, code, 0, 0)
            x11.XSync(display, 0)
            time.sleep(0.03)
        time.sleep(0.2)
    if window:
        time.sleep(0.3)
        x11.XDestroyWindow(display, window)
        x11.XSync(display, 0)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
