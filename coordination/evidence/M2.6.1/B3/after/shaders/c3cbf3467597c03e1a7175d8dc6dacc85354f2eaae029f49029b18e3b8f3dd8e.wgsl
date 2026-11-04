
          @group(0) @binding(0) var source: texture_2d<f32>;
          @group(0) @binding(1) var<storage, read> points: array<vec4f>;
          @group(0) @binding(2) var<storage, read_write> values: array<vec4f>;
          @compute @workgroup_size(1) fn readHdr(@builtin(global_invocation_id) id: vec3u) {
            let dimensions = vec2i(textureDimensions(source));
            let p = clamp(vec2i(points[id.x].xy * vec2f(dimensions)), vec2i(0), dimensions - vec2i(1));
            values[id.x] = textureLoad(source, p, 0);
          }