# Loaded by Rubaxe through RUBYOPT: profiles the program and writes per-method times as JSON to RUBAXE_PROFILE.
# RUBAXE_PROFILE_MODE=trace instruments every Ruby call (exact counts, slower); otherwise the stack is sampled:
# with stackprof where it builds (Linux/macOS), else with a thread reading the main thread's backtrace.
require 'json'

module RubaxeProfile
  OUT = ENV.fetch('RUBAXE_PROFILE')

  def self.now = Process.clock_gettime(Process::CLOCK_MONOTONIC)

  def self.write(rows, mode, samples = nil)
    rows = rows.sort_by { |r| -r[:self_ms] }.first(300)
    File.write(OUT, JSON.generate(mode: mode, samples: samples, rows: rows))
  end

  # "Foo#bar" / "Foo.bar" -> where the method is defined (nil for C methods or unknown names).
  def self.definition(label)
    m = /\A([\w:]+)([#.])(\w+[?!=]?)\z/.match(label) or return
    owner = Object.const_get(m[1])
    (m[2] == '#' ? owner.instance_method(m[3]) : owner.method(m[3])).source_location
  rescue NameError, TypeError
    nil
  end
end

mode = ENV['RUBAXE_PROFILE_MODE'] == 'trace' ? :trace : begin
  require 'stackprof'
  :stackprof
rescue LoadError
  :sampler # stackprof needs POSIX signals: never builds on Windows
end

case mode
when :stackprof
  StackProf.start(mode: :wall, interval: 1000) # 1 ms
  at_exit do
    StackProf.stop
    r = StackProf.results
    ms = r[:interval] / 1000.0
    rows = r[:frames].values.map do |f|
      { name: f[:name], file: f[:file], line: f[:line], calls: nil, total_ms: (f[:total_samples] * ms).round(3), self_ms: (f[:samples] * ms).round(3) }
    end
    RubaxeProfile.write(rows, 'stackprof', r[:samples])
  end
when :sampler
  module RubaxeProfile
    STATS = Hash.new { |h, k| h[k] = { self: 0, total: 0, file: nil, line: nil } }
    START = now
    @count = 0

    # Rubaxe sets RUBY_THREAD_TIMESLICE=1 so this thread gets the GVL often; Windows timers still cap it near 60 Hz.
    SAMPLER = Thread.new(Thread.current) do |main|
      loop do
        sleep 0.001
        locs = main.backtrace_locations or next
        @count += 1
        seen = {}
        locs.each_with_index do |l, i|
          key = l.label.to_s.sub(/\Ablock (\(\d+ levels\) )?in /, '') # a block's time belongs to its method
          s = STATS[key]
          s[:self] += 1 if i.zero?
          s[:total] += 1 unless seen[key]
          s[:file] ||= l.absolute_path || l.path
          s[:line] = [s[:line] || l.lineno, l.lineno].min
          seen[key] = true
        end
      end
    end
    def self.count = @count
  end

  at_exit do
    RubaxeProfile::SAMPLER.kill
    n = RubaxeProfile.count
    ms = n.zero? ? 0 : (RubaxeProfile.now - RubaxeProfile::START) * 1000 / n
    rows = RubaxeProfile::STATS.map do |name, s|
      file, line = RubaxeProfile.definition(name) || [s[:file], s[:line]]
      { name: name, file: file, line: line, calls: nil, total_ms: (s[:total] * ms).round(3), self_ms: (s[:self] * ms).round(3) }
    end
    RubaxeProfile.write(rows, 'sampler', n)
  end
else
  module RubaxeProfile
    STATS = Hash.new { |h, k| h[k] = { calls: 0, total: 0.0, self: 0.0 } }
    STACK = []

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
    RubaxeProfile.write(rows, 'trace')
  end
end
