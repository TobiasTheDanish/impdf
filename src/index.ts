import * as fs from "fs/promises";
import { jsPDF, jsPDFOptions, RGBAData } from "jspdf";

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

  private x: number;
  private maxX: number;
  private y: number;
  private maxY: number;
  private pageDimensions: Dimensions;

  private layouts: Stack<Layout>;

  constructor(options?: jsPDFOptions) {
    this.doc = new jsPDF(options);
    this.pageDimensions = this.getPageDimensions(options?.format);

    this.x = 0;
    this.maxX = this.pageDimensions.w;
    this.y = 15;
    this.maxY = this.pageDimensions.h;
    this.layouts = new Stack();
    this.pushLayout("col");
  }

  save(fileName: string) {
    this.doc.save(fileName);
    this.reset();
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

    const layout = {
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

    this.x = 0;
    this.maxX = this.pageDimensions.w;
    this.y = 15;
    this.maxY = this.pageDimensions.h;

    this.pushLayout("col");
  }

  private wrapText(t: string) {
    const [first, ...rest]: string[] = this.doc.splitTextToSize(
      t,
      this.maxX - this.x,
    );

    const wrappedText: string[] = [
      first,
      ...this.doc.splitTextToSize(rest.join(""), this.maxX),
    ];

    this.pushLayout("col", { gap: 0 });
    for (const line of wrappedText) {
      console.log({ t: line });
      const { w: textWidth, h: textHeight } =
        this.getScaledTextDimensions(line);

      this.doc.text(line, this.x, this.y + textHeight);
      this.moveCursor({
        x: this.x,
        y: this.y,
        w: textWidth,
        h: textHeight,
      });
    }
    this.popLayout();
  }

  private moveCursor(rect: Rectangle) {
    const layout = this.layouts.peek()!;

    if (layout.dir == "col") {
      this.x = rect.x;
      this.y += rect.h + layout.elementGap;
      layout.parentRect.w = Math.max(layout.parentRect.w, rect.w);
      layout.parentRect.h += rect.h + layout.elementGap;
    } else if (layout.dir == "row") {
      this.x += rect.w + layout.elementGap;
      this.y = rect.y;
      layout.parentRect.h = Math.max(layout.parentRect.h, rect.h);
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
    doc.text("Thanks for comming to my ted talk");
  }
  doc.popLayout();

  doc.pushLayout("row");
  doc.pushLayout("col");
  doc.text("Hello again");
  doc.text("Hello again again");
  doc.popLayout();
  doc.pushLayout("col");
  doc.text("Goodbye");
  doc.text("Goodbye again");
  doc.popLayout();
  doc.popLayout();

  doc.save("test.pdf");
}

main();
