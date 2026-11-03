import { markTempDirectoryVerified } from '../../platform/storage/sqlite/tempDirectoryReadiness'

/**
 * 测试环境：开库闸门默认是关的（生产路径必须先探一次临时目录可写）。
 *
 * 这里**只能 import 那个零依赖的小模块**：早先它 import 了 `openSqliteDatabase`，而那个文件
 * 顶部是 `node:sqlite`，于是所有跑在 happy-dom 里的渲染层测试在收集阶段就挂。
 */
markTempDirectoryVerified()
