import * as fs from "fs/promises";
import { jsPDF, jsPDFOptions, RGBAData } from "jspdf";

type Point = {
  x: number;
  y: number;
};

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

type UiSizeKind =
  | "pixels"
  | "text"
  | "percentOfParent"
  | "childrenSum"
  | "childrenMax";
type UiSize =
  | {
      kind: Exclude<UiSizeKind, "childrenSum" | "childrenMax">;
      value: number;
      strictness: number;
    }
  | {
      kind: Extract<UiSizeKind, "childrenSum" | "childrenMax">;
      value?: number;
      strictness?: number;
    };

type WidgetDataKind = "none" | "text" | "image";
type WidgetTextData = {
  kind: Extract<WidgetDataKind, "text">;
  data: string;
  wrap: boolean;
  maxLines: number;
};
type WidgetImageData = {
  kind: Extract<WidgetDataKind, "image">;
  data: string | HTMLImageElement | HTMLCanvasElement | Uint8Array | RGBAData;
  imageFormat: string;
};
type WidgetData =
  | {
      kind: Extract<WidgetDataKind, "none">;
    }
  | WidgetImageData
  | WidgetTextData;

const emptyWidgetData: WidgetData = {
  kind: "none",
};

type LayoutWidgetOptions = {
  fillPercent?: number;
  padding?: number;
  elementPadding?: number;
};

type ImageWidgetOptions = {
  width: {
    sizeKind: Extract<UiSizeKind, "pixels" | "percentOfParent">;
    value: number;
  };
  height: {
    sizeKind: Extract<UiSizeKind, "pixels" | "percentOfParent">;
    value: number;
  };
  padding?: number;
};

type Widget<TWidgetData extends WidgetData = WidgetData> = {
  parent?: Widget;
  children?: Widget[];

  sizeX: UiSize;
  sizeY: UiSize;

  relativePosition: Point;
  dimensions: Dimensions;

  layoutDirection?: LayoutDirection;
  padding: number;
  elementPadding: number;

  data: TWidgetData;
};

type TextWidget = Widget<WidgetTextData>;
type ImageWidget = Widget<WidgetImageData>;

function isTextWidget(w: Widget): w is TextWidget {
  return w.data.kind == "text";
}

function isImageWidget(w: Widget): w is ImageWidget {
  return w.data.kind == "image";
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
  private minY: number = 0;
  private pageDimensions: Dimensions;

  private layouts: Stack<Layout>;

  constructor(options?: jsPDFOptions) {
    this.doc = new jsPDF(options);
    this.pageDimensions = this.getPageDimensions(options?.format);

    this.root = {
      padding: 0,
      elementPadding: 0,
      data: emptyWidgetData,
      sizeX: {
        kind: "pixels",
        value: this.pageDimensions.w,
        strictness: 1,
      },
      sizeY: {
        kind: "childrenMax",
      },
      relativePosition: {
        x: 0,
        y: 0,
      },
      dimensions: {
        w: 0,
        h: 0,
      },
    };

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

  imageWidget(
    data: WidgetImageData["data"],
    format: WidgetImageData["imageFormat"],
    options: ImageWidgetOptions,
  ) {
    const { width, height, padding = 0 } = options;

    const widget: ImageWidget = {
      padding,
      elementPadding: 0,
      sizeX: {
        kind: width.sizeKind,
        value: width.value,
        strictness: 0,
      },
      sizeY: {
        kind: height.sizeKind,
        value: height.value,
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
      data: {
        kind: "image",
        data,
        imageFormat: format,
      },
    };

    this.pushChildWidget(widget);
  }

  textWidget(
    t: string,
    options: {
      wrap?: boolean;
      maxLines?: number;
    } = {},
  ) {
    const { wrap = true, maxLines = Number.MAX_VALUE } = options;
    const { w: textWidth, h: textHeight } = this.getScaledTextDimensions(t);

    const widget: Widget = {
      padding: 0,
      elementPadding: 0,
      data: {
        kind: "text",
        data: t,
        wrap,
        maxLines,
      },
      sizeX: {
        kind: "text",
        value: textWidth,
        strictness: 1,
      },
      sizeY: {
        kind: "text",
        value: textHeight,
        strictness: 1,
      },
      relativePosition: {
        x: 0,
        y: textHeight,
      },
      dimensions: {
        w: 0,
        h: 0,
      },
    };

    this.pushChildWidget(widget);
  }

  rowWidget(options: LayoutWidgetOptions = {}) {
    const { fillPercent = 100, padding = 2, elementPadding = 1 } = options;

    const widget: Widget = {
      padding,
      elementPadding,
      data: emptyWidgetData,
      layoutDirection: "row",
      sizeX: {
        kind: "percentOfParent",
        value: fillPercent,
        strictness: 0,
      },
      sizeY: {
        kind: "childrenMax",
      },
      relativePosition: {
        x: 0,
        y: 0,
      },
      dimensions: {
        w: 0,
        h: 0,
      },
    };

    this.pushParentWidget(widget);
  }

  columnWidget(options: LayoutWidgetOptions = {}) {
    const { fillPercent = 100, padding = 2, elementPadding = 1 } = options;

    const widget: Widget = {
      padding,
      elementPadding,
      data: emptyWidgetData,
      layoutDirection: "col",
      sizeX: {
        kind: "childrenMax",
      },
      sizeY: {
        kind: "percentOfParent",
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
    };

    this.pushParentWidget(widget);
  }

  pushParentWidget(w: Widget): Widget {
    w = this.pushChildWidget(w);
    this.root = w;

    return w;
  }

  popParentWidget() {
    if (this.root.parent == undefined) {
      return;
    }

    this.root = this.root.parent!;
  }

  saveWidget(fileName: string) {
    this.calculateWidgetLayout();

    this.renderWidget(this.root, { x: 0, y: 0 });
    this.doc.save(fileName);
    this.printTree(this.root);
  }

  printTree(w: Widget, level: number = 0) {
    console.log(
      JSON.stringify(
        {
          data: w.data,
          sizeX: w.sizeX,
          sizeY: w.sizeY,
          relativePosition: w.relativePosition,
          dimensions: w.dimensions,
        },
        null,
        level * 2,
      ),
    );

    w.children?.forEach((w) => this.printTree(w, level + 1));
  }

  renderWidget(w: Widget, parentPosition: Point) {
    const position: Point = {
      x: parentPosition.x + w.relativePosition.x,
      y: parentPosition.y + w.relativePosition.y,
    };

    console.log({
      ...w,
      children: w.children?.length ?? 0,
      parent: w.parent ? "exists" : null,
      position,
    });

    if (isTextWidget(w)) {
      this.renderTextWidget(w, position);
    } else if (isImageWidget(w)) {
      this.renderImageWidget(w, position);
    }

    if (w.children != undefined) {
      for (const child of w.children) {
        this.renderWidget(child, position);
      }
    }
  }

  renderTextWidget(w: TextWidget, position: Point) {
    this.doc.text(w.data.data, position.x, position.y + (w.sizeY.value ?? 0));
  }

  renderImageWidget(w: ImageWidget, position: Point) {
    this.doc.addImage(
      w.data.data,
      w.data.imageFormat,
      position.x,
      position.y,
      w.dimensions.w,
      w.dimensions.h,
    );
  }

  calculateWidgetLayout() {
    this.root = this.calculateWidgetSizes(this.root);

    this.root = this.solveLayoutCollisions(this.root);

    this.root = this.calculateRelativePositions(this.root);
  }

  calculateWidgetSizes(w: Widget): Widget {
    if (w.sizeX.kind == "pixels" || w.sizeX.kind == "text") {
      w.dimensions.w = w.sizeX.value;
    } else if (
      w.sizeX.kind == "percentOfParent" &&
      w.parent &&
      w.parent.sizeX.kind != "childrenSum"
    ) {
      w.dimensions.w = w.parent.dimensions.w * (w.sizeX.value / 100);
    }

    if (w.sizeY.kind == "pixels" || w.sizeY.kind == "text") {
      w.dimensions.h = w.sizeY.value;
    } else if (
      w.sizeY.kind == "percentOfParent" &&
      w.parent &&
      w.parent.sizeY.kind != "childrenSum"
    ) {
      w.dimensions.h = w.parent.dimensions.h * (w.sizeY.value / 100);
    }

    if (w.children != undefined) {
      for (let i = 0; i < w.children.length; i++) {
        w.children[i] = this.calculateWidgetSizes(w.children[i]);
      }
    }

    if (w.sizeX.kind == "childrenSum") {
      w.dimensions.w =
        w.children?.reduce((acc, cur) => acc + cur.dimensions.w, 0) ?? 0;
    } else if (w.sizeX.kind == "childrenMax") {
      w.dimensions.w =
        w.children?.reduce(
          (acc, cur) => Math.max(acc, cur.dimensions.w),
          Number.MIN_VALUE,
        ) ?? 0;
    }
    if (w.sizeY.kind == "childrenSum") {
      w.dimensions.h =
        w.children?.reduce((acc, cur) => acc + cur.dimensions.h, 0) ?? 0;
    } else if (w.sizeY.kind == "childrenMax") {
      w.dimensions.h =
        w.children?.reduce(
          (acc, cur) => Math.max(acc, cur.dimensions.h),
          Number.MIN_VALUE,
        ) ?? 0;
    }

    return w;
  }

  solveLayoutCollisions(w: Widget): Widget {
    if (w.children != undefined) {
      let totalChildDimensions = w.children.reduce<Dimensions>(
        (acc, cur, i) => ({
          w:
            acc.w +
            cur.dimensions.w +
            (w.layoutDirection == "row" && i > 0 ? w.elementPadding : 0),
          h:
            acc.h +
            cur.dimensions.h +
            (w.layoutDirection != "row" && i > 0 ? w.elementPadding : 0),
        }),
        { w: 0, h: 0 },
      );

      if (totalChildDimensions.w > w.dimensions.w) {
        let violation = totalChildDimensions.w - w.dimensions.w;

        for (let i = 0; i < w.children.length; i++) {
          const childSizeDecrease =
            (violation / w.children.length) *
            (1 - (w.children[i].sizeX.strictness ?? 0));

          w.children[i].dimensions.w -= childSizeDecrease;
        }
      }
      if (totalChildDimensions.h > w.dimensions.h) {
        let violation = totalChildDimensions.h - w.dimensions.h;

        for (let i = 0; i < w.children.length; i++) {
          const childSizeDecrease =
            (violation / w.children.length) *
            (1 - (w.children[i].sizeY.strictness ?? 0));

          w.children[i].dimensions.h -= childSizeDecrease;
        }
      }
    }

    return w;
  }

  calculateRelativePositions(w: Widget, index: number = -1): Widget {
    let relativePosition: Point;
    let sibling: Widget | undefined = undefined;
    if (w.parent == undefined) {
      relativePosition = {
        x: this.minX,
        y: this.minY,
      };
    } else if (index == 0) {
      relativePosition = {
        x: w.padding + w.relativePosition.x,
        y: w.padding + w.relativePosition.y,
      };
    } else if (index > 0) {
      sibling = w.parent.children![index - 1];
      const siblingRelativePosition = sibling.relativePosition;
      const siblingDimensions = sibling.dimensions;
      const padding = w.parent.elementPadding;

      if (w.parent.layoutDirection == "row") {
        relativePosition = {
          x: siblingRelativePosition.x + siblingDimensions.w + padding,
          y: siblingRelativePosition.y,
        };
      } else {
        relativePosition = {
          x: siblingRelativePosition.x,
          y: siblingRelativePosition.y + siblingDimensions.h + padding,
        };
      }
    } else {
      throw new Error("unreachable");
    }

    w.relativePosition = {
      ...relativePosition,
    };

    const parentDim = {
      w: w.parent
        ? w.parent.relativePosition.x + w.parent.dimensions.w
        : this.pageDimensions.w,
      h: w.parent
        ? w.parent.relativePosition.y + w.parent.dimensions.h
        : this.pageDimensions.h,
    };

    if (
      w.relativePosition.x + w.dimensions.w >= parentDim.w &&
      w.parent?.layoutDirection == "row" &&
      sibling != undefined &&
      (!isTextWidget(w) || w.data.wrap == false)
    ) {
      const newY = w.relativePosition.y + sibling.dimensions.h;
      const newX =
        w.parent?.children?.find(
          (child) => child.relativePosition.y + child.dimensions.h <= newY,
        )?.relativePosition.x ?? 0;

      w.relativePosition.x = newX;
      w.relativePosition.y = newY;
    } else if (
      w.relativePosition.x + w.dimensions.w >= parentDim.w &&
      isTextWidget(w) &&
      w.data.wrap == true
    ) {
      const [first, ...wrappedText]: string[] = this.doc.splitTextToSize(
        w.data.data,
        parentDim.w - w.relativePosition.x,
      );

      const col: Widget = {
        parent: w.parent,
        children: [],
        padding: 0,
        elementPadding: 0,
        data: emptyWidgetData,
        layoutDirection: "col",
        sizeX: {
          kind: "childrenMax",
        },
        sizeY: {
          kind: "childrenSum",
        },
        relativePosition: w.relativePosition,
        dimensions: {
          w: 0,
          h: 0,
        },
      };
      for (let i = 0; i < wrappedText.length; i++) {
        if (i >= w.data.maxLines - 1) {
          break;
        }

        const text = wrappedText[i];
        const { w: textWidth, h: textHeight } =
          this.getScaledTextDimensions(text);

        col.children!.push({
          parent: col,
          padding: 0,
          elementPadding: 0,
          data: {
            kind: "text",
            data: text,
            wrap: false,
            maxLines: Number.MAX_VALUE,
          },
          sizeX: {
            kind: "text",
            value: textWidth,
            strictness: 1,
          },
          sizeY: {
            kind: "text",
            value: textHeight,
            strictness: 1,
          },
          relativePosition: {
            x: 0,
            y: 0,
          },
          dimensions: {
            w: 0,
            h: 0,
          },
        });
      }

      w = this.calculateWidgetSizes(col);
    }

    if (w.children != undefined) {
      for (let i = 0; i < w.children.length; i++) {
        w.children[i] = this.calculateRelativePositions(w.children[i], i);
      }
    }

    return w;
  }

  pushChildWidget(w: Widget): Widget {
    w.parent = this.root;
    if (this.root.children == undefined) {
      this.root.children = [];
    }
    this.root.children.push(w);

    return w;
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
    let wrappedText: string[] = this.doc.splitTextToSize(t, this.maxX - this.x);

    while (wrappedText.length > 0) {
      const [line, ...rest] = wrappedText;
      if (line == "") {
        break;
      }

      console.log({ t: line });
      const { w: textWidth, h: textHeight } =
        this.getScaledTextDimensions(line);

      this.doc.text(line, this.x, this.y + textHeight);
      this.moveCursor(
        {
          x: this.x,
          y: this.y,
          w: textWidth,
          h: textHeight,
        },
        true,
      );

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
      layout.parentRect.w = Math.max(
        layout.parentRect.w,
        rect.x + rect.w - layout.parentRect.x,
      );
      layout.parentRect.h += rect.h + layout.elementGap;
    } else if (layout.dir == "row") {
      if (
        wrap &&
        rect.y + rect.h >= layout.parentRect.y + layout.parentRect.h
      ) {
        this.x = layout.parentRect.x;
        this.y = rect.y + rect.h;
      } else if (wrap) {
        this.x = rect.x;
        this.y = rect.y + rect.h;
      } else {
        this.x = rect.x + rect.w + layout.elementGap;
        this.y = rect.y;
      }
      layout.parentRect.h = Math.max(
        layout.parentRect.h,
        rect.y + rect.h - layout.parentRect.y,
      );
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
    doc.text(
      "Thanks for coming to my ted talk. Sorry i was not done yet, but now i am.",
    );
    doc.text("This is a new long text within the same row.");
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

async function widgetMain() {
  const doc = new ImPdf({
    format: "a6",
  });

  const imageBuffer = await fs.readFile("Baby-mike.jpg");

  doc.rowWidget({ elementPadding: 1 });
  {
    doc.imageWidget(imageBuffer, "JPEG", {
      height: {
        sizeKind: "pixels",
        value: 50,
      },
      width: {
        sizeKind: "percentOfParent",
        value: 50,
      },
    });
    doc.textWidget(
      "This is a hella long text that should wrap, but im not sure if it will do it correctly",
      { wrap: true },
    );
    doc.textWidget(
      "And this is another hella long text that should wrap, but im not sure if it will do it correctly",
      { wrap: true },
    );
    doc.popParentWidget();
  }
  doc.popParentWidget();

  doc.saveWidget("test.pdf");
}

//main();

widgetMain();
