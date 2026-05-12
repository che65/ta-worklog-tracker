import { useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'ta-worklog-records'
const WEEKLY_REQUIRED_HOURS = 8

const emptyForm = {
  date: '',
  taskName: '',
  startTime: '',
  endTime: '',
  note: '',
}

function getTodayInputValue() {
  const today = new Date()
  return formatDateInputValue(today)
}

function formatDateInputValue(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function isValidDateString(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return false

  const date = parseLocalDate(dateString)
  const [year, month, day] = dateString.split('-').map(Number)

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  )
}

function getWeekRange(referenceDate = new Date()) {
  const start = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  )
  const day = start.getDay()
  const daysFromMonday = day === 0 ? 6 : day - 1
  start.setDate(start.getDate() - daysFromMonday)
  start.setHours(0, 0, 0, 0)

  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  end.setHours(23, 59, 59, 999)

  return { start, end }
}

function isDateInRange(dateString, range) {
  if (!dateString) return false
  const date = parseLocalDate(dateString)
  return date >= range.start && date <= range.end
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function isValidTimeString(time) {
  if (!/^\d{2}:\d{2}$/.test(time)) return false

  const [hours, minutes] = time.split(':').map(Number)
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
}

function calculateDuration(startTime, endTime) {
  if (!isValidTimeString(startTime) || !isValidTimeString(endTime)) return 0
  return (timeToMinutes(endTime) - timeToMinutes(startTime)) / 60
}

function formatHours(value) {
  return Number(value).toFixed(2)
}

function formatTimer(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const remainingSeconds = safeSeconds % 60

  return [hours, minutes, remainingSeconds].map((unit) => String(unit).padStart(2, '0')).join(':')
}

function formatTimeInputValue(date) {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${hours}:${minutes}`
}

function escapeCsvCell(value) {
  const stringValue = String(value ?? '')

  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replaceAll('"', '""')}"`
  }

  return stringValue
}

function downloadCsv(filename, rows) {
  const csvContent = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
  const blob = new Blob([`\ufeff${csvContent}`], {
    type: 'text/csv;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function createRecordId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function sortRecords(records) {
  return [...records].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date)
    if (dateCompare !== 0) return dateCompare

    const timeCompare = a.startTime.localeCompare(b.startTime)
    if (timeCompare !== 0) return timeCompare

    return (a.createdAt || 0) - (b.createdAt || 0)
  })
}

function normalizeRecords(value) {
  if (!Array.isArray(value)) return []

  return value
    .filter((record) => {
      const duration = Number(record.duration)

      return (
        record &&
        isValidDateString(record.date) &&
        typeof record.taskName === 'string' &&
        record.taskName.trim() &&
        isValidTimeString(record.startTime) &&
        isValidTimeString(record.endTime) &&
        (timeToMinutes(record.endTime) > timeToMinutes(record.startTime) ||
          (record.source === 'timer' && Number.isFinite(duration) && duration > 0))
      )
    })
    .map((record) => ({
      id: record.id || createRecordId(),
      date: record.date,
      taskName: record.taskName.trim(),
      startTime: record.startTime,
      endTime: record.endTime,
      note: typeof record.note === 'string' ? record.note.trim() : '',
      duration:
        record.source === 'timer' && Number.isFinite(Number(record.duration))
          ? Number(record.duration)
          : calculateDuration(record.startTime, record.endTime),
      source: record.source === 'timer' ? 'timer' : 'manual',
      createdAt: Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
    }))
}

function App() {
  const [records, setRecords] = useState([])
  const [form, setForm] = useState({ ...emptyForm, date: getTodayInputValue() })
  const [error, setError] = useState('')
  const [hasLoaded, setHasLoaded] = useState(false)
  const [today, setToday] = useState(() => new Date())
  const [timerStatus, setTimerStatus] = useState('idle')
  const [timerStartedAt, setTimerStartedAt] = useState(null)
  const [timerLastStartedAt, setTimerLastStartedAt] = useState(null)
  const [timerElapsedSeconds, setTimerElapsedSeconds] = useState(0)
  const [clockNow, setClockNow] = useState(() => Date.now())

  useEffect(() => {
    try {
      const savedRecords = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
      setRecords(normalizeRecords(savedRecords))
    } catch {
      setRecords([])
    } finally {
      setHasLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (hasLoaded) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
    }
  }, [hasLoaded, records])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setToday(new Date())
    }, 60 * 1000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (timerStatus !== 'running') return undefined

    const intervalId = window.setInterval(() => {
      setClockNow(Date.now())
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [timerStatus])

  const weekRange = useMemo(() => getWeekRange(today), [today])
  const sortedRecords = useMemo(() => sortRecords(records), [records])

  const currentWeekRecords = useMemo(
    () => sortedRecords.filter((record) => isDateInRange(record.date, weekRange)),
    [sortedRecords, weekRange],
  )

  const usedHours = useMemo(
    () => currentWeekRecords.reduce((sum, record) => sum + record.duration, 0),
    [currentWeekRecords],
  )

  const liveTimerSeconds =
    timerStatus === 'running' && timerLastStartedAt
      ? timerElapsedSeconds + Math.floor((clockNow - timerLastStartedAt) / 1000)
      : timerElapsedSeconds
  const liveTimerHours =
    timerStartedAt && isDateInRange(formatDateInputValue(new Date(timerStartedAt)), weekRange)
      ? liveTimerSeconds / 3600
      : 0
  const displayedUsedHours = usedHours + liveTimerHours
  const remainingHours = WEEKLY_REQUIRED_HOURS - displayedUsedHours
  const overtimeHours = Math.max(0, displayedUsedHours - WEEKLY_REQUIRED_HOURS)
  const previewDuration = calculateDuration(form.startTime, form.endTime)
  const timerCanStop = timerStatus !== 'idle' && liveTimerSeconds > 0

  const remainingByRecordId = useMemo(() => {
    const result = new Map()
    let runningTotal = 0

    sortedRecords.forEach((record) => {
      if (isDateInRange(record.date, weekRange)) {
        runningTotal += record.duration
        result.set(record.id, WEEKLY_REQUIRED_HOURS - runningTotal)
      } else {
        result.set(record.id, null)
      }
    })

    return result
  }, [sortedRecords, weekRange])

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setError('')
  }

  function validateForm() {
    if (!form.date || !form.taskName.trim() || !form.startTime || !form.endTime) {
      return '请填写工作日期、具体工作、起始时间和结束时间。'
    }

    if (
      !isValidDateString(form.date) ||
      !isValidTimeString(form.startTime) ||
      !isValidTimeString(form.endTime)
    ) {
      return '请填写有效的工作日期、起始时间和结束时间。'
    }

    if (timeToMinutes(form.endTime) <= timeToMinutes(form.startTime)) {
      return '结束时间必须晚于起始时间。'
    }

    return ''
  }

  function handleSubmit(event) {
    event.preventDefault()
    const validationError = validateForm()

    if (validationError) {
      setError(validationError)
      return
    }

    const duration = calculateDuration(form.startTime, form.endTime)
    const record = {
      id: createRecordId(),
      date: form.date,
      taskName: form.taskName.trim(),
      startTime: form.startTime,
      endTime: form.endTime,
      note: form.note.trim(),
      duration,
      createdAt: Date.now(),
    }

    setRecords((current) => [...current, record])
    setForm({ ...emptyForm, date: form.date })
    setError('')
  }

  function startTimer() {
    const now = Date.now()

    if (timerStatus === 'running') return

    if (timerStatus === 'idle') {
      setTimerStartedAt(now)
      setTimerElapsedSeconds(0)
    }

    setTimerLastStartedAt(now)
    setClockNow(now)
    setTimerStatus('running')
    setError('')
  }

  function pauseTimer() {
    if (timerStatus !== 'running') return

    const now = Date.now()
    setTimerElapsedSeconds((current) => current + Math.floor((now - timerLastStartedAt) / 1000))
    setTimerLastStartedAt(null)
    setClockNow(now)
    setTimerStatus('paused')
  }

  function stopTimer() {
    if (!timerCanStop || !timerStartedAt) return

    const now = Date.now()
    const finalSeconds =
      timerStatus === 'running' && timerLastStartedAt
        ? timerElapsedSeconds + Math.floor((now - timerLastStartedAt) / 1000)
        : timerElapsedSeconds

    if (finalSeconds <= 0) return

    const startDate = new Date(timerStartedAt)
    const endDate = new Date(now)
    const record = {
      id: createRecordId(),
      date: formatDateInputValue(startDate),
      taskName: form.taskName.trim() || '计时工作',
      startTime: formatTimeInputValue(startDate),
      endTime: formatTimeInputValue(endDate),
      note: form.note.trim(),
      duration: finalSeconds / 3600,
      source: 'timer',
      createdAt: now,
    }

    setRecords((current) => [...current, record])
    setTimerStatus('idle')
    setTimerStartedAt(null)
    setTimerLastStartedAt(null)
    setTimerElapsedSeconds(0)
    setClockNow(now)
    setForm((current) => ({ ...emptyForm, date: current.date }))
    setError('')
  }

  function deleteRecord(recordId) {
    setRecords((current) => current.filter((record) => record.id !== recordId))
  }

  function clearAllRecords() {
    if (records.length === 0) return

    if (window.confirm('确定要清空全部工时记录吗？此操作无法撤销。')) {
      setRecords([])
    }
  }

  function exportCurrentWeekRecords() {
    if (currentWeekRecords.length === 0) return

    const headers = [
      '日期',
      '具体工作',
      '起始时间',
      '结束时间',
      '本项花费时间',
      '本周剩余工时',
      '备注',
    ]
    const rows = currentWeekRecords.map((record) => {
      const rowRemaining = remainingByRecordId.get(record.id)

      return [
        record.date,
        record.taskName,
        record.startTime,
        record.endTime,
        `${formatHours(record.duration)} 小时`,
        `${formatHours(rowRemaining)} 小时`,
        record.note,
      ]
    })
    const filename = `TA工时记录_${formatDateInputValue(weekRange.start)}_${formatDateInputValue(
      weekRange.end,
    )}.csv`

    downloadCsv(filename, [headers, ...rows])
  }

  return (
    <main className="app-shell">
      <section className="page-header">
        <div>
          <p className="eyebrow">每周 8 小时 · 本周从周一开始统计</p>
          <h1>助教工时记录器 TA Worklog Tracker</h1>
        </div>
        <button className="ghost-button" type="button" onClick={clearAllRecords}>
          清空全部记录
        </button>
      </section>

      <section className="summary-grid" aria-label="本周工时概览">
        <article className="summary-card">
          <span>每周规定总工时</span>
          <strong>{formatHours(WEEKLY_REQUIRED_HOURS)} 小时</strong>
        </article>
        <article className="summary-card">
          <span>本周已用工时</span>
          <strong>{formatHours(displayedUsedHours)} 小时</strong>
        </article>
        <article className={`summary-card ${remainingHours < 0 ? 'warning' : ''}`}>
          <span>本周剩余工时</span>
          <strong>{formatHours(Math.max(0, remainingHours))} 小时</strong>
        </article>
        <article className={`summary-card ${overtimeHours > 0 ? 'danger' : 'steady'}`}>
          <span>超时状态</span>
          <strong>
            {overtimeHours > 0 ? `已超出 ${formatHours(overtimeHours)} 小时` : '未超时'}
          </strong>
        </article>
      </section>

      <section className="content-grid">
        <div className="left-stack">
          <form className="panel form-panel" onSubmit={handleSubmit}>
            <div className="panel-heading">
              <h2>新增工作记录</h2>
              <p>输入起止时间后会自动计算本项花费时间。</p>
            </div>

            <div className="form-grid">
              <label>
                工作日期
                <input name="date" type="date" value={form.date} onChange={updateField} />
              </label>
              <label>
                具体工作
                <input
                  name="taskName"
                  type="text"
                  placeholder="例如：批改作业"
                  value={form.taskName}
                  onChange={updateField}
                />
              </label>
              <label>
                起始时间
                <input name="startTime" type="time" value={form.startTime} onChange={updateField} />
              </label>
              <label>
                结束时间
                <input name="endTime" type="time" value={form.endTime} onChange={updateField} />
              </label>
            </div>

            <label>
              备注
              <textarea
                name="note"
                rows="3"
                placeholder="可选，例如：第 3 章习题反馈"
                value={form.note}
                onChange={updateField}
              />
            </label>

            <div className="form-footer">
              <div className="duration-preview">
                本项花费时间：
                <strong>{previewDuration > 0 ? formatHours(previewDuration) : '0.00'} 小时</strong>
              </div>
              <button className="primary-button" type="submit">
                添加记录
              </button>
            </div>

            {error && <p className="error-message">{error}</p>}
          </form>

          <section className="panel timer-panel" aria-label="实时计时器">
            <div className="panel-heading">
              <h2>实时计时器</h2>
              <p>开始后会即时计入本周已用工时；停止后自动生成一条记录。</p>
            </div>

            <div className={`clock-face ${timerStatus === 'running' ? 'is-running' : ''}`}>
              <div className="clock-mark mark-12" />
              <div className="clock-mark mark-3" />
              <div className="clock-mark mark-6" />
              <div className="clock-mark mark-9" />
              <div className="clock-hand hour-hand" />
              <div className="clock-hand minute-hand" />
              <div className="clock-hand second-hand" />
              <div className="clock-center" />
            </div>

            <div className="timer-readout">{formatTimer(liveTimerSeconds)}</div>
            <div className="timer-meta">
              <span>
                {timerStatus === 'running' ? '计时中' : timerStatus === 'paused' ? '已暂停' : '未开始'}
              </span>
              <span>实时折算 {formatHours(liveTimerHours)} 小时</span>
            </div>

            <div className="timer-actions">
              <button
                className="primary-button"
                type="button"
                onClick={startTimer}
                disabled={timerStatus === 'running'}
              >
                开始计时
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={pauseTimer}
                disabled={timerStatus !== 'running'}
              >
                暂停计时
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={stopTimer}
                disabled={!timerCanStop}
              >
                停止计时
              </button>
            </div>
          </section>
        </div>

        <section className="panel table-panel">
          <div className="panel-heading table-heading">
            <div>
              <h2>工时记录</h2>
              <p>所有记录都会保留；本周统计只计算当前周内的记录。</p>
            </div>
            <div className="table-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={exportCurrentWeekRecords}
                disabled={currentWeekRecords.length === 0}
              >
                导出本周记录
              </button>
              <span className="record-count">{records.length} 条记录</span>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>工作日期</th>
                  <th>具体工作</th>
                  <th>起始时间</th>
                  <th>结束时间</th>
                  <th>本项花费时间</th>
                  <th>本周剩余工时</th>
                  <th>备注</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {sortedRecords.length === 0 ? (
                  <tr>
                    <td className="empty-state" colSpan="8">
                      暂无记录，添加第一条 TA 工作记录吧。
                    </td>
                  </tr>
                ) : (
                  sortedRecords.map((record) => {
                    const rowRemaining = remainingByRecordId.get(record.id)
                    const isCurrentWeek = rowRemaining !== null

                    return (
                      <tr key={record.id} className={!isCurrentWeek ? 'muted-row' : ''}>
                        <td>{record.date}</td>
                        <td className="task-cell">{record.taskName}</td>
                        <td>{record.startTime}</td>
                        <td>{record.endTime}</td>
                        <td>{formatHours(record.duration)} 小时</td>
                        <td className={rowRemaining < 0 ? 'negative-hours' : ''}>
                          {isCurrentWeek ? `${formatHours(rowRemaining)} 小时` : '非本周'}
                        </td>
                        <td>{record.note || '—'}</td>
                        <td>
                          <button
                            className="delete-button"
                            type="button"
                            onClick={() => deleteRecord(record.id)}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  )
}

export default App
