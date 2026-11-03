import { markTempDirectoryVerified } from '../../platform/storage/sqlite/openSqliteDatabase'

/**
 * 测试环境：`openSqliteDatabase` 的临时目录闸门默认是关的（生产路径必须先探一次可写）。
 *
 * 用例会大量直接开 `:memory:` 或临时目录里的库，逐个去调探针既没意义也没必要——CI 与开发机的
 * 临时目录本来就可写。这里统一打开一次，**闸门本身的正确性由 `sqliteTempReadiness.test.ts`
 * 用 `vi.resetModules()` 取新模块实例来验**（那份用例不能受这个 setup 影响，所以它自己重置模块）。
 */
markTempDirectoryVerified()
