import {
  BuilderChartConfigWithDateRange,
  ChartConfigWithDateRange,
  DisplayType,
  SourceKind,
  TLogSource,
  TSessionSource,
} from '@hyperdx/common-utils/dist/types';

import { buildDashboardReplaySearchUrl } from '@/ChartUtils';

// The search page reads these params with nuqs (double-encoded). Mirror that
// read path so the tests assert the value the destination actually recovers.
const readWhere = (url: URL) =>
  decodeURIComponent(url.searchParams.get('where') ?? '');
const readFilters = (url: URL) =>
  JSON.parse(decodeURIComponent(url.searchParams.get('filters') ?? '[]'));

const dateRange: [Date, Date] = [
  new Date('2026-01-01T00:00:00.000Z'),
  new Date('2026-01-01T01:00:00.000Z'),
];

const logSource = {
  id: 'logs',
  name: 'Logs',
  kind: SourceKind.Log,
  connection: 'clickhouse',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, Body',
} satisfies TLogSource;

const sessionSource = {
  id: 'sessions',
  name: 'Sessions',
  kind: SourceKind.Session,
  connection: 'clickhouse',
  from: { databaseName: 'default', tableName: 'sessions' },
  timestampValueExpression: 'Timestamp',
  traceSourceId: 'traces',
} satisfies TSessionSource;

const builderConfig = {
  displayType: DisplayType.Number,
  connection: 'clickhouse',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  select: [
    {
      aggFn: 'count',
      aggCondition: '',
      aggConditionLanguage: 'lucene',
      valueExpression: '',
    },
  ],
  where: 'service:web',
  whereLanguage: 'lucene',
  filters: [{ type: 'sql', condition: "SeverityText = 'error'" }],
  timestampValueExpression: 'Timestamp',
  dateRange,
} satisfies BuilderChartConfigWithDateRange;

describe('buildDashboardReplaySearchUrl', () => {
  it('preserves the source, query, filters, and dashboard time range', () => {
    const result = buildDashboardReplaySearchUrl({
      source: logSource,
      config: builderConfig,
      dateRange,
    });

    expect(result).not.toBeNull();

    const url = new URL(result ?? '', 'http://localhost');
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('source')).toBe('logs');
    expect(readWhere(url)).toBe('service:web');
    expect(readFilters(url)).toEqual([
      { type: 'sql', condition: "SeverityText = 'error'" },
    ]);
    expect(url.searchParams.get('from')).toBe(
      dateRange[0].getTime().toString(),
    );
    expect(url.searchParams.get('to')).toBe(dateRange[1].getTime().toString());
  });

  it('promotes a single per-series condition when there is no global query', () => {
    const result = buildDashboardReplaySearchUrl({
      source: logSource,
      config: {
        ...builderConfig,
        where: '',
        select: [
          {
            ...builderConfig.select[0],
            aggCondition: 'status:error',
          },
        ],
      },
      dateRange,
    });

    expect(result).not.toBeNull();
    expect(readWhere(new URL(result ?? '', 'http://localhost'))).toBe(
      'status:error',
    );
  });

  it('preserves newlines in a multi-line SQL where through the nuqs round-trip', () => {
    const multilineWhere = [
      "ServiceName = 'receive' and",
      "RA['cluster_type'] = 'data-plane' and",
      "Namespace = 'lighthouse'",
    ].join('\n');

    const result = buildDashboardReplaySearchUrl({
      source: logSource,
      config: { ...builderConfig, where: multilineWhere, whereLanguage: 'sql' },
      dateRange,
    });

    expect(result).not.toBeNull();

    const query = (result ?? '').split('?')[1] ?? '';
    // nuqs reads one layer via URLSearchParams; the recovered value must not
    // contain a literal newline, or nuqs's next URL re-render emits a raw
    // newline that the browser strips, joining the lines.
    const nuqsRead = new URLSearchParams(query).get('where') ?? '';
    expect(nuqsRead).not.toMatch(/[\n\r]/);

    // The destination then parses it (decodeURIComponent) back to the original.
    expect(decodeURIComponent(nuqsRead)).toBe(multilineWhere);
  });

  it('rejects per-series conditions that cannot be faithfully replayed', () => {
    const seriesWithCondition = {
      ...builderConfig.select[0],
      aggCondition: 'status:error',
    };

    expect(
      buildDashboardReplaySearchUrl({
        source: logSource,
        config: {
          ...builderConfig,
          where: '',
          select: [seriesWithCondition, builderConfig.select[0]],
        },
        dateRange,
      }),
    ).toBeNull();

    expect(
      buildDashboardReplaySearchUrl({
        source: logSource,
        config: {
          ...builderConfig,
          select: [seriesWithCondition],
        },
        dateRange,
      }),
    ).toBeNull();
  });

  it('rejects non-builder charts, metric charts, and non-searchable sources', () => {
    const rawSqlConfig = {
      configType: 'sql',
      displayType: DisplayType.Number,
      connection: 'clickhouse',
      sqlTemplate: 'SELECT count() FROM default.otel_logs',
      dateRange,
    } satisfies ChartConfigWithDateRange;

    expect(
      buildDashboardReplaySearchUrl({
        source: logSource,
        config: rawSqlConfig,
        dateRange,
      }),
    ).toBeNull();

    expect(
      buildDashboardReplaySearchUrl({
        source: logSource,
        config: {
          ...builderConfig,
          metricTables: {
            gauge: 'otel_metrics_gauge',
            histogram: 'otel_metrics_histogram',
            sum: 'otel_metrics_sum',
            summary: 'otel_metrics_summary',
            'exponential histogram': 'otel_metrics_exponential_histogram',
          },
        },
        dateRange,
      }),
    ).toBeNull();

    expect(
      buildDashboardReplaySearchUrl({
        source: sessionSource,
        config: builderConfig,
        dateRange,
      }),
    ).toBeNull();
  });
});
