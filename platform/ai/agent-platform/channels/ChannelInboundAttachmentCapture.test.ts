/**
 * 入站附件「字节落盘」的判据骨架（0.4.5）。
 *
 * 现状：这一版**只登记引用、不存字节**——回合里那句「收到一张图片，没有文字。」由
 * `channelAttachmentTurnText` 生成，`stableRef` 就在句子里；字节从来没进过本机。
 *
 * 用户 2026-11-24 拍板：没配文的图，附件字节存本地、跟保留期一起清。存储那一半正在由
 * 「存储缓存」落 `platform/storage/contentAddressedBlobs.ts`（内容寻址、sha256 全 64 位、
 * 写后读回校验、`listRefs` 读不到回 `undefined` 而不是空数组）。接口到位前这里只留**用例形状**，
 * 不写存储、不建目录——先跑通一条会红的实现，比先写一遍存储再改接口便宜。
 *
 * 五条要钉住的事（缺一条都不算做完）：
 * 1. 只带图的入站消息**落盘**，消息行上只留 `fileRef`，不留字节；
 * 2. mime 白名单（png/jpeg/webp）与 2MB 上限之外**拒收并给原因**，不是静默丢；
 * 3. 删消息只删行、**不碰字节**：同一张图可能被多条消息引用（内容寻址去重）；
 * 4. 取字节时**「文件缺失」= 错误态 + 可重试**，`「没有附件」= 空态`——两者不许都画成「没有」；
 * 5. 保留期清理跑一次要报**搬了多少 / 还剩多少**（与存储缓存同一套清理入口）。
 *
 * 什么时候把 todo 换成真用例：拿到 `contentAddressedBlobs` 的哈希与签名之后，一笔一条。
 */
import { describe, it } from 'vitest'

describe('inbound attachment bytes', () => {
  it.todo('stores an image-only attachment through the content-addressed blobs and keeps only its fileRef on the message row')
  it.todo('refuses a mime outside png/jpeg/webp or a file over 2MB, with a reason the reader can read')
  it.todo('removes the message row on delete but never the bytes, because another message may share them')
  it.todo('reads a missing file as an error with a retry path, and "no attachment" as an empty state')
  it.todo('reports how many refs the retention sweep removed and how many remain, through the storage-cache entry')
})