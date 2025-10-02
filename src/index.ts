import * as fs from "fs/promises";
import { jsPDF, jsPDFOptions, RGBAData } from "jspdf";

type Point = {
  x: number;
  y: number;
}

type Dimensions = {
  w: number;
  h: number;
};

type Rectangle = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type LayoutDirection = "col" | "row";
type Layout = {
  dir: LayoutDirection;
  parentRect: Rectangle;
  elementGap: number;
};

type UiSizeKind = 'pixels' | 'text' | 'percentOfParent' | 'childrenSum' | 'childrenMax'
type UiSize = {
	kind: Exclude<UiSizeKind, 'childrenSum' | 'childrenMax'>,
	value: number,
	strictness: number,
} | {
	kind: Extract<UiSizeKind, 'childrenSum' | 'childrenMax'>,
}

type Widget = {
	parent?: Widget,
	children?: Widget[],

	sizeX: UiSize,
	sizeY: UiSize,

	relativePosition: Point,
	dimensions: Dimensions,

	layoutDirection?: LayoutDirection,
	text?: string,
}

class Stack<T> {
  private arr: T[] = [];

  size(): number {
    return this.arr.length;
  }

  push(data: T) {
    this.arr.push(data);
  }

  update(data: T) {
    this.arr[this.arr.length - 1] = data;
  }

  pop(): T | undefined {
    return this.arr.pop();
  }

  peek(): T | undefined {
    return this.arr[this.arr.length - 1];
  }
}

const colors = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [0, 0, 0],
];

class ImPdf {
  private doc: jsPDF;

	private root: Widget;

  private x: number;
  private minX: number = 0;
  private maxX: number;
  private y: number;
  private minY: number = 10;
  private pageDimensions: Dimensions;

  private layouts: Stack<Layout>;

  constructor(options?: jsPDFOptions) {
    this.doc = new jsPDF(options);
    this.pageDimensions = this.getPageDimensions(options?.format);

		this.root = {
			sizeX: {
				kind: 'pixels',
				value: this.pageDimensions.w,
				strictness: 1,
			},
			sizeY: {
				kind: 'childrenMax',
			},
			relativePosition: {
				x: 0,
				y: 0,
			},
			dimensions: {
				w: 0,
				h: 0,
			},
		}

    this.x = this.minX;
    this.maxX = this.pageDimensions.w;
    this.y = this.minY;
    this.layouts = new Stack();
    this.pushLayout("col");
  }

  save(fileName: string) {
    this.doc.save(fileName);
    this.reset();
  }

	textWidget(t: string) {
    const { w: textWidth, h: textHeight } = this.getScaledTextDimensions(t);

		const widget: Widget = {
			text: t,
			sizeX: {
				kind: 'text',
				value: textWidth,
				strictness: 0,
			},
			sizeY: {
				kind: 'text',
				value: textHeight,
				strictness: 0,
			},
			relativePosition: {
				x: 0,
				y: 0,
			},
			dimensions: {
				w: 0,
				h: 0,
			},
		}

		this.pushChildWidget(widget)
	}

	rowWidget(fillPercent: number = 100) {
		const widget: Widget = {
			layoutDirection: 'row',
			sizeX: {
				kind: 'percentOfParent',
				value: fillPercent,
				strictness: 0,
			},
			sizeY: {
				kind: 'childrenMax',
			},
			relativePosition: {
				x: 0,
				y: 0,
			},
			dimensions: {
				w: 0,
				h: 0,
			},
		}

		this.pushParentWidget(widget)
	}

	columnWidget(fillPercent: number = 100) {
		const widget: Widget = {
			layoutDirection: 'col',
			sizeX: {
				kind: 'childrenMax',
			},
			sizeY: {
				kind: 'percentOfParent',
				value: fillPercent,
				strictness: 0,
			},
			relativePosition: {
				x: 0,
				y: 0,
			},
			dimensions: {
				w: 0,
				h: 0,
			},
		}

		this.pushParentWidget(widget)
	}

	pushParentWidget(w: Widget): Widget {
		w = this.pushChildWidget(w)
		this.root = w

		return w
	}

	popParentWidget() {
		if (this.root.parent == undefined) {
			return
		}

		this.root = this.root.parent!
	}

	saveWidget(fileName: string) {
		this.calculateWidgetLayout()

		this.renderWidget(this.root, {x: 0, y: 0})
    this.doc.save(fileName);
	}

	renderWidget(w: Widget, parentPosition: Point) {
		const position: Point = {
			x: parentPosition.x + w.relativePosition.x,
			y: parentPosition.y + w.relativePosition.y,
		}

		console.log({
			...w,
			children: w.children?.length ?? 0,
			parent: w.parent ? 'exists' : null,
			position,
		})

		if (w.sizeX.kind == 'text' && w.sizeY.kind == 'text' && w.text != undefined) {
			this.doc.text(w.text, position.x, position.y)
		}

		if (w.children != undefined) {
			for (const child of w.children) {
				this.renderWidget(child, position)
			}
		}
	}

	calculateWidgetLayout() {
		this.root = this.calculateWidgetSizes(this.root)

		this.root = this.solveLayoutCollisions(this.root)

		this.root = this.calculateRelativePositions(this.root)
	}

	calculateWidgetSizes(w: Widget): Widget {
		if (w.sizeX.kind == 'pixels' || w.sizeX.kind == 'text') {
			w.dimensions.w = w.sizeX.value
		} else if (w.sizeX.kind == 'percentOfParent' && w.parent && w.parent.sizeX.kind != 'childrenSum') {
			w.dimensions.w = w.parent.dimensions.w * (w.sizeX.value / 100)
		}

		if (w.sizeY.kind == 'pixels' || w.sizeY.kind == 'text') {
			w.dimensions.h = w.sizeY.value
		} else if (w.sizeY.kind == 'percentOfParent' && w.parent && w.parent.sizeY.kind != 'childrenSum') {
			w.dimensions.h = w.parent.dimensions.h * (w.sizeY.value / 100)
		}

		if (w.children != undefined) {
			for (let i = 0; i < w.children.length; i++) {
				w.children[i] = this.calculateWidgetSizes(w.children[i])
			}
		}

		if (w.sizeX.kind == 'childrenSum') {
			w.dimensions.w = w.children?.reduce((acc, cur) => acc + cur.dimensions.w, 0) ?? 0
		} else if (w.sizeX.kind == 'childrenMax') {
			w.dimensions.w = w.children?.reduce((acc, cur) => Math.max(acc, cur.dimensions.w), Number.MIN_VALUE) ?? 0
		}
		if (w.sizeY.kind == 'childrenSum') {
			w.dimensions.h = w.children?.reduce((acc, cur) => acc + cur.dimensions.h, 0) ?? 0
		} else if (w.sizeY.kind == 'childrenMax') {
			w.dimensions.h = w.children?.reduce((acc, cur) => Math.max(acc, cur.dimensions.h), Number.MIN_VALUE) ?? 0
		}

		return w
	}

	solveLayoutCollisions(w: Widget): Widget {

		return w
	}

	calculateRelativePositions(w: Widget, index: number = -1): Widget {
		let relativePosition: Point
		if (w.parent == undefined) {
			relativePosition = {
				x: this.minX,
				y: this.minY,
			}
		} else if (index == 0) {
			relativePosition = {
				x: 0,
				y: 0,
			}
		} else if (index > 0) {
			const sibling = w.parent.children?.[index-1] 

			if (w.parent.layoutDirection == 'row') {
				relativePosition = {
					x: (sibling?.relativePosition.x ?? 0) + (sibling?.dimensions.w ?? 0),
					y: (sibling?.relativePosition.y ?? 0),
				}
			} else {
				relativePosition = {
					x: (sibling?.relativePosition.x ?? 0),
					y: (sibling?.relativePosition.y ?? 0) + (sibling?.dimensions.h ?? 0),
				}
			}

		} else {
			throw new Error('unreachable')
		}

		w.relativePosition = {
			...relativePosition,
		}

		if (w.children != undefined) {
			for (let i = 0; i < w.children.length; i++) {
				w.children[i] = this.calculateRelativePositions(w.children[i], i)
			}
		}

		return w
	}

	pushChildWidget(w: Widget): Widget {
		w.parent = this.root
		if (this.root.children == undefined) {
			this.root.children = []
		} 
		this.root.children.push(w)

		return w
	}

  text(t: string) {
    const { w: textWidth, h: textHeight } = this.getScaledTextDimensions(t);

    if (this.x + textWidth > this.maxX) {
      this.wrapText(t);
    } else {
      console.log({ t });

      this.doc.text(t, this.x, this.y + textHeight);
      this.moveCursor({
        x: this.x,
        y: this.y,
        w: textWidth,
        h: textHeight,
      });
    }
  }

  image(
    imageData:
      | string
      | HTMLImageElement
      | HTMLCanvasElement
      | Uint8Array
      | RGBAData,
    format: string,
    w: number,
    h: number,
  ) {
    this.doc.addImage(imageData, format, this.x, this.y, w, h);
    this.moveCursor({
      x: this.x,
      y: this.y,
      w,
      h,
    });
  }

  pushLayout(
    dir: LayoutDirection,
    options?: {
      gap?: number;
    },
  ) {
    options = options ?? {};

    const layout: Layout = {
      dir,
      parentRect: {
        y: this.y,
        x: this.x,
        w: 0,
        h: 0,
      },
      elementGap: options.gap ?? 1,
    };
    this.layouts.push(layout);

    const color = colors[this.layouts.size() - 1];

    console.log({ action: "push", layout, color });

    // @ts-ignore
    this.doc.setDrawColor(...color);
    // @ts-ignore
    this.doc.setTextColor(...color);
  }

  popLayout() {
    const old = this.layouts.pop()!;
    this.doc.rect(
      old.parentRect.x,
      old.parentRect.y,
      old.parentRect.w,
      old.parentRect.h,
    );

    const color = colors[this.layouts.size() - 1] ?? colors[0];

    // @ts-ignore
    this.doc.setDrawColor(...color);
    // @ts-ignore
    this.doc.setTextColor(...color);
    console.log({ action: "pop", layout: old, color });

    if (this.layouts.size() <= 0) return;
    this.moveCursor(old.parentRect);
  }

  private reset() {
    while (this.layouts.size() > 0) {
      this.popLayout();
    }

    this.x = this.minX;
    this.maxX = this.pageDimensions.w;
    this.y = this.minY;

    this.pushLayout("col");
  }

  private wrapText(t: string) {
    let wrappedText: string[] = this.doc.splitTextToSize(
      t,
      this.maxX - this.x,
    );

    while (wrappedText.length > 0) {
			const [line, ...rest] = wrappedText
			if (line == "") {
				break
			}

      console.log({ t: line });
      const { w: textWidth, h: textHeight } =
        this.getScaledTextDimensions(line);

      this.doc.text(line, this.x, this.y + textHeight);
      this.moveCursor({
        x: this.x,
        y: this.y,
        w: textWidth,
        h: textHeight,
      }, true);

			wrappedText = this.doc.splitTextToSize(
				rest.join(" "),
				this.maxX - this.x,
			);
    }
  }

  private moveCursor(rect: Rectangle, wrap: boolean = false) {
    const layout = this.layouts.peek()!;

    if (layout.dir == "col") {
      this.x = rect.x;
      this.y = rect.y + rect.h + layout.elementGap;
      layout.parentRect.w = Math.max(layout.parentRect.w, rect.x + rect.w - layout.parentRect.x);
      layout.parentRect.h += rect.h + layout.elementGap;
    } else if (layout.dir == "row") {
			if (wrap && rect.y + rect.h >= layout.parentRect.y + layout.parentRect.h) {
				this.x = layout.parentRect.x
				this.y = rect.y + rect.h
			} else if (wrap) {
				this.x = rect.x
				this.y = rect.y + rect.h
			} else {
				this.x = rect.x + rect.w + layout.elementGap;
				this.y = rect.y;
			}
      layout.parentRect.h = Math.max(layout.parentRect.h, rect.y + rect.h - layout.parentRect.y);
      layout.parentRect.w += rect.w + layout.elementGap;
    }

    console.log({
      currentLayout: {
        ...layout,
      },
    });

    this.layouts.update(layout);
  }

  private getPageDimensions(format: jsPDFOptions["format"]): Dimensions {
    const scaleFactor = this.doc.internal.scaleFactor;

    let pageFormat: [number, number];
    if (Array.isArray(format)) {
      pageFormat = [format[0], format[1]];
    } else {
      // @ts-ignore
      pageFormat = this.doc.__private__?.getPageFormat?.(format ?? "a4");

      pageFormat = (pageFormat?.map((n) => n / scaleFactor) as [
        number,
        number,
      ]) ?? [200, 200];
    }

    return {
      w: pageFormat[0],
      h: pageFormat[1],
    };
  }

  private getScaledTextDimensions(t: string): { w: number; h: number } {
    const { w: textWidth, h: textHeight } = this.doc.getTextDimensions(t);

    return {
      w: textWidth,
      h: textHeight,
    };
  }
}

async function main() {
  const doc = new ImPdf({
    format: "a6",
  });

  const imageBuffer = await fs.readFile("Baby-mike.jpg");

  doc.pushLayout("row");
  {
    doc.image(imageBuffer, "JPEG", 50, 50);
    doc.text("Thanks for coming to my ted talk. Sorry i was not done yet, but now i am.");
		doc.text("This is a new long text within the same row.")
  }
  doc.popLayout();

  doc.pushLayout("row");
	{
		doc.pushLayout("col");
		{
			doc.text("Hello again");
			doc.text("Hello again again");
		}
		doc.popLayout();
		doc.pushLayout("col");
		{
			doc.text("Goodbye");
			doc.text("Goodbye again");
		}
		doc.popLayout();
	}
  doc.popLayout();

  doc.save("test.pdf");
}

function widgetMain() {
	const doc = new ImPdf({
    format: "a6",
  })

	doc.rowWidget()
	{
		doc.textWidget("Hello")
		doc.textWidget("World.")
		doc.textWidget("This")
		doc.textWidget("is")
		doc.textWidget("a")
		doc.textWidget("row")
		doc.textWidget("widget")
	} doc.popParentWidget()

	doc.saveWidget("test.pdf");
}

//main();

widgetMain()
