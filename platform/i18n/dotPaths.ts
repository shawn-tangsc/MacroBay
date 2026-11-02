/**
 * 把一棵嵌套文案对象摊成「点分路径」联合类型。
 *
 * 用途只有一个：让**键**在编译期被检查，而不是靠正则扫文本。正则看不进变量——
 * 今天有人把键放进常量，明天会有人包一层函数，后天又漏一处（架构师 2026-11-02 的判词）。
 * 类型能看见，所以键写错、常量写错、把函数结果传进去，都在 `tsc` 阶段红。
 *
 * 界面上的一条告诫同样有效：**别对整张产品文案表求一次联合**。文案表是嵌套对象，
 * 全表联合会让每个引用它的文件都重算一遍类型，改一句文案全量重编。按页面/模块取子树，
 * 只让那一屏的文件付这份代价。
 *
 * 数组按展开后的数字下标给路径（`items.0.title`），与产品文案展平器的口径一致。
 */
export type DotPaths<T> = T extends string
  ? never
  : T extends readonly unknown[]
    ? `${number}`
    : {
        [K in keyof T & string]: T[K] extends string
          ? K
          : T[K] extends readonly unknown[]
            ? K | `${K}.${DotPaths<T[K]>}`
            : K | `${K}.${DotPaths<T[K]>}`
      }[keyof T & string]
