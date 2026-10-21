import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUraRuntime } from '../src/main/ura'
import { createUraTools } from '../src/main/harness/ura-tools'
import { PageSessions } from '../src/main/ura/page-sessions'

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'ura-'))
  const file = join(dir, 'hello.txt')
  await writeFile(file, 'line one\nline two\n')
  const markdownFile = join(dir, 'note.md')
  await writeFile(markdownFile, '# Title\n\nbody\n')
  const htmlFile = join(dir, 'page.html')
  await writeFile(htmlFile, '<h1>Title</h1>\n')
  const ref = `file://${file}`

  const { ura, registry, host } = await createUraRuntime({
    pluginRoots: [join(process.cwd(), 'src', 'plugins')],
    dataRoot: join(tmpdir(), 'ura-smoke-data'),
    workspace: () => dir,
  })

  console.log('registry:', JSON.stringify(registry.snapshot(), null, 2))
  console.log('host:', host.list().map((p) => p.id))
  console.log('diagnostics:', registry.diagnostics())

  const agent = await ura.read(ref)
  console.log('agent read:', agent.docType, agent.degraded, JSON.stringify(agent.projection))

  const editor = await ura.read(ref, { as: 'editor' })
  console.log('editor read:', JSON.stringify(editor.projection))

  const markdown = await ura.read(`file://${markdownFile}`, { as: 'editor' })
  console.log('markdown:', markdown.docType, markdown.projection)
  const html = await ura.read(`file://${htmlFile}`, { as: 'editor' })
  console.log('html:', html.docType, html.projection)

  console.log('ls:', (await ura.ls(`file://${dir}`)).map((e) => e.name))
  console.log('find:', (await ura.find('*.txt', { scope: `file://${dir}` })).map((e) => e.name))
  console.log('grep:', await ura.grep('two', { scope: `file://${dir}` }))

  const session = await ura.openWrite(ref)
  session.stage({ type: 'replace-all', content: 'line one\nline TWO\n' })
  console.log('commit:', await session.commit())
  console.log('after:', (await ura.read(ref)).projection)

  const a = await ura.openWrite(ref)
  const b = await ura.openWrite(ref)
  a.stage({ type: 'replace-all', content: 'A' })
  b.stage({ type: 'replace-all', content: 'B' })
  console.log('commit a:', await a.commit())
  console.log('commit b:', await b.commit())

  const tools = createUraTools(ura)
  const tool = (name: string) => tools.find((t) => t.name === name)!
  const run = async (name: string, params: unknown) =>
    tool(name).execute('t', params as never, undefined, undefined, {} as never)

  console.log('tool read:', JSON.stringify(await run('read', { ref, offset: 1, limit: 1 })))
  console.log('tool ls:', JSON.stringify(await run('ls', { ref: `file://${dir}` })))
  console.log('tool find:', JSON.stringify(await run('find', { pattern: '*.md', scope: `file://${dir}` })))
  console.log('tool grep:', JSON.stringify(await run('grep', { pattern: 'Title', scope: `file://${dir}` })))
  console.log('tool write:', JSON.stringify(await run('write', { ref: `file://${join(dir, 'new.txt')}`, content: 'hello' })))
  console.log('tool edit:', JSON.stringify(await run('edit', { ref: `file://${join(dir, 'new.txt')}`, start: 0, end: 5, expected: 'hello', content: 'world' })))

  const session2 = await ura.openWrite(ref)
  session2.stage({ type: 'replace-range', anchor: { start: 0, end: 1 }, content: 'Z' })
  console.log('range commit:', await session2.commit())
  console.log('final:', (await ura.read(ref)).projection)

  const pages = new PageSessions(ura)
  const mdRef = `file://${markdownFile}`
  const openedPage = await pages.open(mdRef)
  if (openedPage.type !== 'page') throw new Error('expected page target')
  const page = openedPage.info
  console.log('page open:', page.docType, page.surface, page.page.split('/').slice(-1)[0])
  console.log('page save:', await pages.save(page.id, '# Changed\n'))
  const secondOpened = await pages.open(mdRef)
  if (secondOpened.type !== 'page') throw new Error('expected page target')
  const second = secondOpened.info
  console.log('page save2:', await pages.save(second.id, '# Second\n'))
  const stale = await pages.save(page.id, '# Stale\n')
  console.log('page stale:', stale.ok === false, stale.ok === false ? Object.keys(stale.conflict) : [])
  const reloaded = await pages.reload(page.id)
  console.log('page reload:', reloaded.version !== page.version)
  pages.close(page.id)
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
