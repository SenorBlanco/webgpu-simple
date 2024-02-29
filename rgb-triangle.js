let shaders = `
  struct VSInput {
    @location(0) position: vec2<f32>,
    @location(1) color: vec3<f32>
  };

  struct Varyings {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>
  };

  @vertex
  fn vsMain(v : VSInput) -> Varyings {
    return Varyings(vec4(v.position, 0.0, 1.0), vec4(v.color, 1.0));
  }

  @fragment
  fn fsMain(v : Varyings) -> @location(0) vec4<f32> {
    return v.color;
  }`

const render = async (gpu, canvasContext) => {
  // canvas independent part
  const device = await (await gpu.requestAdapter()).requestDevice()
  const format = gpu.getPreferredCanvasFormat() // 'bgra8unorm'
  const commandEncoder = device.createCommandEncoder()
  const verts = new Float32Array([
     // vec2<f32> position, float3<f32> color
     0.0,  1.0, 1.0, 0.0, 0.0,
    -1.0, -1.0, 0.0, 1.0, 0.0,
     1.0, -1.0, 0.0, 0.0, 1.0,
  ]);

  const vertBuffer = device.createBuffer({
    size: verts.byteLength,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  });

  new Float32Array(vertBuffer.getMappedRange()).set(verts);
  vertBuffer.unmap();

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: device.createShaderModule({ code: shaders }),
      entryPoint: 'vsMain',
      buffers: [
        {
          arrayStride: 5 * 4, // Size in bytes of one triangle vertex
          attributes: [
            {
              // position
              shaderLocation: 0,
              offset: 0,
              format: 'float32x2',
            },
            {
              // color
              shaderLocation: 1,
              offset: 2 * 4,
              format: 'float32x3'
            },
          ],
        },
      ],
    },
    fragment: {
      module: device.createShaderModule({ code: shaders }),
      entryPoint: 'fsMain',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list' },
  })

  // canvas dependent part
  canvasContext.configure({ device, format, alphaMode: 'premultiplied' })
  const passEncoder = commandEncoder.beginRenderPass({
    colorAttachments: [
      {
        view: canvasContext.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0.05, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  })
  passEncoder.setVertexBuffer(0, vertBuffer);
  passEncoder.setPipeline(pipeline)
  passEncoder.draw(3, 1, 0, 0)
  passEncoder.end()

  // draw
  device.queue.submit([commandEncoder.finish()])
}

if (navigator.gpu) {
  render(
    navigator.gpu,
    document.getElementById('canvas').getContext('webgpu')
  ).then()
} else {
  alert('WebGPU is not supported or is not enabled, see https://webgpu.io')
}
