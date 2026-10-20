# Loaded by Rubaxe through RUBYOPT: a TracePoint profiler (no gems) writing per-method calls and times as JSON to RUBAXE_PROFILE.
# shortcut: instruments every Ruby method call, so hot loops run several times slower; switch to vernier/stackprof if users need precision.
require 'json'

module RubaxeProfile
  STATS = Hash.new { |h, k| h[k] = { calls: 0, total: 0.0, self: 0.0 } }
  STACK = []

  def self.now = Process.clock_gettime(Process::CLOCK_MONOTONIC)

  TRACE = TracePoint.new(:call, :return) do |tp|
    if tp.event == :call
      STACK << [tp.defined_class, tp.method_id, tp.path, tp.lineno, now, 0.0]
    elsif (frame = STACK.pop) # returns from methods entered before tracing started have no frame
      klass, meth, path, line, start, child = frame
      total = now - start
      s = STATS[[klass, meth, path, line]]
      s[:calls] += 1
      s[:total] += total
      s[:self] += total - child
      STACK.last[5] += total if STACK.last
    end
  end
end

RubaxeProfile::TRACE.enable

at_exit do
  RubaxeProfile::TRACE.disable
  rows = RubaxeProfile::STATS.map do |(klass, meth, path, line), s|
    { name: "#{klass}##{meth}", file: path, line: line, calls: s[:calls], total_ms: (s[:total] * 1000).round(3), self_ms: (s[:self] * 1000).round(3) }
  end
  File.write(ENV.fetch('RUBAXE_PROFILE'), JSON.generate(rows.sort_by { |r| -r[:self_ms] }.first(300)))
end
