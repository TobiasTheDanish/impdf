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
  screenRect: Rectangle;

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

function isDownwardSizeDependent(w: Widget): boolean {
	const downwardDependentSizeKinds: UiSizeKind[] = [
		'childrenSum',
		'childrenMax',
	]

	return downwardDependentSizeKinds.includes(w.sizeX.kind) || downwardDependentSizeKinds.includes(w.sizeY.kind)
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

  private minX: number = 0;
  private maxX: number;
  private minY: number = 0;
  private pageDimensions: Dimensions;

  constructor(options?: jsPDFOptions) {
    this.doc = new jsPDF(options);
    this.pageDimensions = this.getPageDimensions(options?.format);

    this.root = {
      layoutDirection: "col",
      padding: 0,
      elementPadding: 0,
      data: emptyWidgetData,
      sizeX: {
        kind: "pixels",
        value: this.pageDimensions.w,
        strictness: 1,
      },
      sizeY: {
        kind: "childrenSum",
      },
      relativePosition: {
        x: 0,
        y: 0,
      },
      dimensions: {
        w: 0,
        h: 0,
      },
      screenRect: {
        x: 0,
        y: 0,
        w: 0,
        h: 0,
      },
    };

    this.maxX = this.pageDimensions.w;
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
        strictness: width.sizeKind == 'pixels' ? 1 : 0,
      },
      sizeY: {
        kind: height.sizeKind,
        value: height.value,
        strictness: height.sizeKind == 'pixels' ? 1 : 0,
      },
      relativePosition: {
        x: 0,
        y: 0,
      },
      dimensions: {
        w: 0,
        h: 0,
      },
      screenRect: {
        x: 0,
        y: 0,
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
        y: 0,
      },
      dimensions: {
        w: 0,
        h: 0,
      },
      screenRect: {
        x: 0,
        y: 0,
        w: 0,
        h: 0,
      },
    };

    this.pushChildWidget(widget);
  }

  rowWidget(children: (row: ImPdf) => void, options: LayoutWidgetOptions = {}) {
    const { fillPercent, padding = 2, elementPadding = 1 } = options;

    const widget: Widget = {
      padding,
      elementPadding,
      data: emptyWidgetData,
      layoutDirection: "row",
      sizeX: {
        kind: fillPercent ? "percentOfParent" : 'childrenSum',
        value: fillPercent ? fillPercent : 0,
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
      screenRect: {
        x: 0,
        y: 0,
        w: 0,
        h: 0,
      },
    };

    this.pushParentWidget(widget);

    children(this);

    this.popParentWidget();
  }

  columnWidget(
    children: (col: ImPdf) => void,
    options: LayoutWidgetOptions = {},
  ) {
    const { fillPercent, padding = 2, elementPadding = 1 } = options;

    const widget: Widget = {
      padding,
      elementPadding,
      data: emptyWidgetData,
      layoutDirection: "col",
      sizeX: {
        kind: "childrenMax",
      },
      sizeY: {
        kind: fillPercent ? "percentOfParent" : 'childrenSum',
        value: fillPercent ? fillPercent : 0,
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
      screenRect: {
        x: 0,
        y: 0,
        w: 0,
        h: 0,
      },
    };

    this.pushParentWidget(widget);

    children(this);

    this.popParentWidget();
  }

  pushParentWidget(w: Widget): Widget {
    w = this.pushChildWidget(w);
    this.root = w;

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

  popParentWidget() {
    if (this.root.parent == undefined) {
      return;
    }

    this.root = this.root.parent!;
  }

  saveWidget(fileName: string) {
    this.calculateWidgetLayoutFromRoot();

    this.renderWidget(this.root);
    this.doc.save(fileName);
    this.printTree(this.root);
  }

  printTree(w: Widget, level: number = 0) {
		this.printWidget(w, level)

    w.children?.forEach((w) => this.printTree(w, level + 1));
  }

	printWidget(w: Widget, level: number = 0) {
		const sizeRect: Rectangle = {
			x: w.screenRect.x ? w.screenRect.x : w.relativePosition.x,
			y: w.screenRect.y ? w.screenRect.y : w.relativePosition.y,
			h: w.screenRect.h ? w.screenRect.h : w.dimensions.h,
			w: w.screenRect.w ? w.screenRect.w : w.dimensions.w,
		}

    console.log(
      `${" ".repeat(level * 2)}WidgetType: ${w.layoutDirection ? w.layoutDirection : w.data.kind}. SizeKinds: { x: ${w.sizeX.kind}, y: ${w.sizeY.kind} }. Size: ${JSON.stringify(sizeRect)}`,
    );
	}

  renderWidget(w: Widget) {
    const p = w.screenRect;

    if (isTextWidget(w)) {
      this.renderTextWidget(w, p);
    } else if (isImageWidget(w)) {
      this.renderImageWidget(w, p);
    } else {
			//this.doc.rect(p.x, p.y, p.w, p.h);
		}

    if (w.children != undefined) {
      for (const child of w.children) {
        this.renderWidget(child);
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

  calculateWidgetLayoutFromRoot() {
		this.root = this.calculateWidgetLayout(this.root)
  }

  calculateWidgetLayout(w: Widget): Widget {
		if (w.parent == undefined) {
			console.log("\nTREE PRE CALCULATE WIDGET SIZES\n")
			this.printTree(w)
		}
    w = this.calculateWidgetSizes(w);
		if (w.parent == undefined) {
			console.log("\nTREE POST CALCULATE WIDGET SIZES\n")
			this.printTree(w)
		}
    w = this.solveLayoutCollisions(w);
		if (w.parent == undefined) {
			console.log("\nTREE POST SOLVE LAYOUT COLLISIONS\n")
			this.printTree(w)
		}
    w = this.calculateRelativePositions(w, w.parent ? 0 : -1);
		if (w.parent == undefined) {
			console.log("\nTREE POST CALCULATE RELATIVE POSITIONS\n")
			this.printTree(w)
		}

		return w
	}

  calculateWidgetSizes(w: Widget): Widget {
    w = this.calculateStandaloneSizes(w);
    w = this.calculateUpwardsDependentSizes(w);

		w.children = w.children?.map(c => this.calculateWidgetSizes(c))

    w = this.calculateDownwardDependentSizes(w);

    return this.clampWidgetSizes(w);
  }

  calculateStandaloneSizes(w: Widget): Widget {
    if (w.sizeX.kind == "pixels" || w.sizeX.kind == "text") {
      w.dimensions.w = w.sizeX.value + w.padding * 2;
    }

    if (w.sizeY.kind == "pixels" || w.sizeY.kind == "text") {
      w.dimensions.h = w.sizeY.value + w.padding * 2;
    }

    //w.children = w.children?.map((c) => this.calculateStandaloneSizes(c));

    return w;
  }

  calculateUpwardsDependentSizes(w: Widget): Widget {
    if (w.sizeX.kind == "percentOfParent") {
      let parent: Widget | undefined = w.parent;
      while (parent != undefined) {
        if (
          !(
            parent.sizeX.kind == "childrenSum" ||
            parent.sizeX.kind == "childrenMax"
          )
        ) {
          break;
        } else {
          parent = parent.parent;
        }
      }

      const parentDim: Dimensions = parent?.dimensions ?? {
        w: this.maxX,
        h: Number.MAX_VALUE,
      };

      w.dimensions.w = parentDim.w * (w.sizeX.value / 100);
    }

    if (w.sizeY.kind == "percentOfParent") {
      let parent: Widget | undefined = w.parent;
      while (parent != undefined) {
        if (
          !(
            parent.sizeY.kind == "childrenSum" ||
            parent.sizeY.kind == "childrenMax"
          )
        ) {
          break;
        } else {
          parent = parent.parent;
        }
      }

      const parentDim: Dimensions = parent?.dimensions ?? {
        w: this.maxX,
        h: Number.MAX_VALUE,
      };

      w.dimensions.h = parentDim.h * (w.sizeY.value / 100);
    }

    //w.children = w.children?.map((c) => this.calculateUpwardsDependentSizes(c));

    return w;
  }

  calculateDownwardDependentSizes(w: Widget): Widget {
    if (w.children == undefined) {
      return w;
    }

		//w.children = w.children.map(c => this.calculateDownwardDependentSizes(c))

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
        w.children?.reduce((acc, cur) => {
          return acc + cur.dimensions.h;
        }, 0) ?? 0;
    } else if (w.sizeY.kind == "childrenMax") {
      w.dimensions.h =
        w.children?.reduce(
          (acc, cur) => Math.max(acc, cur.dimensions.h),
          Number.MIN_VALUE,
        ) ?? 0;
    }

    return w;
  }

  clampWidgetSizes(w: Widget): Widget {
    w.dimensions.w = Math.max(this.minX, Math.min(this.maxX, w.dimensions.w));
    w.dimensions.h = Math.max(this.minY, w.dimensions.h);

    w.children = w.children?.map((c) => this.clampWidgetSizes(c));

    return w;
  }

	solveLayoutCollisions(w: Widget): Widget {
		if (w.children == undefined) {
			if (isTextWidget(w) && this.shouldTextWrap(w)) {
				const maxWidth = w.parent?.dimensions.w ?? this.pageDimensions.w
				w = this.addColWidgetForTextWrapping(w, maxWidth)
				w = this.calculateWidgetSizes(w)
			}

			return w
		}

		let totalChildDimensions = w.children.reduce<Dimensions>(
			(acc, cur, i) => w.layoutDirection == 'row' ? ({
				w: acc.w + cur.dimensions.w + (i > 0 ? w.elementPadding : 0),
				h: Math.max(acc.h, cur.dimensions.h),
			}) : ({
				w: Math.max(acc.w, cur.dimensions.w),
				h: acc.h + cur.dimensions.h + (i > 0 ? w.elementPadding : 0),
			}),
			{ w: 0, h: 0 },
		);

		if (totalChildDimensions.w > w.dimensions.w) {
			let violation = totalChildDimensions.w - w.dimensions.w;

			for (let i = 0; i < w.children.length; i++) {
				const childSizeDecrease =
					(violation / (w.children.length-i)) *
						(1 - (w.children[i].sizeX.strictness ?? 0));

				w.children[i].dimensions.w -= childSizeDecrease;
				violation -= childSizeDecrease
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

		w.children = w.children.map(c => this.solveLayoutCollisions(c))

		if (isDownwardSizeDependent(w)) {
			w = this.calculateDownwardDependentSizes(w)
		}

		return w;
	}

	shouldTextWrap(w: TextWidget): boolean {
		if (w.data.wrap == false) {
			console.log(`Text should not wrap: ${w.data.data}`)
			return false
		}

		const maxWidth = w.parent?.dimensions.w ?? this.pageDimensions.w

		console.log({maxWidth, dim: w.dimensions, text: w.data.data })
		return maxWidth <= w.dimensions.w
	}

	addColWidgetForTextWrapping(w: TextWidget, maxWidth: number): Widget {
		const wrappedText: string[] = this.doc.splitTextToSize(
			w.data.data,
			maxWidth,
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
			screenRect: w.screenRect,
		};

		for (let i = 0; i < wrappedText.length; i++) {
			if (i >= w.data.maxLines) {
				break;
			}

			const text = wrappedText[i];
			const { w: textWidth, h: textHeight } =
			this.getScaledTextDimensions(text);

			const prevSibling = col.children!.at(-1)
			const relPos: Point = {
				x: i > 0 && prevSibling ? prevSibling.relativePosition.x : 0,
				y: i > 0 && prevSibling ? prevSibling.relativePosition.y + textHeight : 0,
			}

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
				relativePosition: relPos,
				dimensions: {
					w: textWidth,
					h: textHeight
				},
				screenRect: {
					x: 0,
					y: 0,
					w: textWidth,
					h: textHeight
				},
			});
		}

		col.dimensions = col.children!.reduce((acc, cur) => ({
			w: Math.max(acc.w, cur.dimensions.w),
			h: acc.h + cur.dimensions.h,
		}), {w:0,h:0})

		console.log("\n\n")
		this.printTree(col)
		console.log("\n\n")

		return col
	}

  calculateRelativePositions(w: Widget, index: number): Widget {
    if (w.dimensions.w == 0 || w.dimensions.h == 0) {
      throw new Error(
        `Widget with zero size\n${JSON.stringify({
          ...w,
          parent: w.parent ? "exists" : "null",
          children: w.children?.length ?? 0,
        }, null, 2)}`,
      );
    }

    let relativePosition: Point;
    let sibling: Widget | undefined = undefined;
    if (w.parent == undefined) {
      relativePosition = {
        x: this.minX,
        y: this.minY,
      };
    } else if (index == 0) {
      relativePosition = {
        x: w.padding,
        y: w.padding,
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

    w.screenRect = {
      x: w.parent ? w.parent.screenRect.x + w.relativePosition.x : this.minX,
      y: w.parent ? w.parent.screenRect.y + w.relativePosition.y : this.minY,
      ...w.dimensions,
    };

    if (w.children != undefined) {
			w.children = w.children.map((c, i) => this.calculateRelativePositions(c, i))
    }

    return w;
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

async function widgetMain() {
  const doc = new ImPdf({
    format: "a6",
  });

  const imageBuffer = await fs.readFile("Baby-mike.jpg");

  doc.rowWidget(
    (row) => {
      row.imageWidget(imageBuffer, "JPEG", {
        height: {
          sizeKind: "pixels",
          value: 50,
        },
        width: {
          sizeKind: "pixels",
          value: 50,
        },
      });
      row.columnWidget((col) => {
        col.textWidget(
          "This is a hella long text that should wrap, but im not sure if it will do it correctly.",
        );
        col.textWidget(
          "The quick brown fox jumps over the lazy dog. THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG.",
        );
      });
    },
    { fillPercent: 100, elementPadding: 1 },
  );

	doc.textWidget(
		"This is a hella long text that should wrap, but im not sure if it will do it correctly.",
	);

  doc.saveWidget("test.pdf");
}

//main();

widgetMain();
