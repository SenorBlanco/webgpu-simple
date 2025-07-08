/** Shows an error dialog if getting an adapter wasn't successful. */
function quitIfAdapterNotAvailable(adapter) {
    if (!('gpu' in navigator)) {
        fail('navigator.gpu is not defined - WebGPU not available in this browser');
    }
    if (!adapter) {
        fail("requestAdapter returned null - this sample can't run on this system");
    }
}

function quitIfWebGPUNotAvailable(adapter, device) {
    if (!device) {
        quitIfAdapterNotAvailable(adapter);
        fail('Unable to get a device for an unknown reason');
        return;
    }
    device.lost.then((reason) => {
        fail(`Device lost ("${reason.reason}"):\n${reason.message}`);
    });
    device.addEventListener('uncapturederror', (ev) => {
        fail(`Uncaptured error:\n${ev.error.message}`);
    });
}
/** Fail by showing a console error, and dialog box if possible. */
const fail = (() => {
    function createErrorOutput() {
        if (typeof document === 'undefined') {
            // Not implemented in workers.
            return {
                show(msg) {
                    console.error(msg);
                },
            };
        }
        const dialogBox = document.createElement('dialog');
        dialogBox.close();
        document.body.append(dialogBox);
        const dialogText = document.createElement('pre');
        dialogText.style.whiteSpace = 'pre-wrap';
        dialogBox.append(dialogText);
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'OK';
        closeBtn.onclick = () => dialogBox.close();
        dialogBox.append(closeBtn);
        return {
            show(msg) {
                // Don't overwrite the dialog message while it's still open
                // (show the first error, not the most recent error).
                if (!dialogBox.open) {
                    dialogText.textContent = msg;
                    dialogBox.showModal();
                }
            },
        };
    }
    let output;
    return (message) => {
        if (!output)
            output = createErrorOutput();
        output.show(message);
        throw new Error(message);
    };
})();

let shaders = `
  struct Uniforms {
    mvpMatrix : mat4x4<f32>,
    alpha : f32,
  }
  @binding(0) @group(0) var<uniform> uniforms : Uniforms;

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
    let position = uniforms.mvpMatrix * vec4(v.position, 0.0, 1.0);
    return Varyings(position, vec4(v.color, 1.0));
  }

  @fragment
  fn fsMain(v : Varyings) -> @location(0) vec4<f32> {
    return v.color * uniforms.alpha;
  }`

const initialize = async (gpu, canvasContext) => {
  const adapter = await navigator.gpu?.requestAdapter({
    featureLevel: 'compatibility',
  });
  const device = await adapter?.requestDevice();
  quitIfWebGPUNotAvailable(adapter, device);
  const format = gpu.getPreferredCanvasFormat(); // 'bgra8unorm'

  const texture = device.createTexture({
    size: [1, 1, 6],
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const view = texture.createView({ dimension: 'cube-array' });

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

  const uniformBuffer = device.createBuffer({
    size: 4 * 20, // 4x4 matrix + alpha (padded to vec4)
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const uniformData = new Float32Array([ 1.0, 0.0, 0.0, 0.0,
                                         0.0, 1.0, 0.0, 0.0,
                                         0.0, 0.0, 1.0, 0.0,
                                         0.0, 0.0, 0.0, 1.0,
                                         0.5, 0.0, 0.0, 0.0 ]);

  const uniformBindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: uniformBuffer,
        },
      },
    ],
  });

  function render() {
    const commandEncoder = device.createCommandEncoder();
    device.queue.writeBuffer(uniformBuffer, 0, uniformData.buffer, uniformData.byteOffset, uniformData.byteLength);

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
    passEncoder.setBindGroup(0, uniformBindGroup);
    passEncoder.setPipeline(pipeline)
    passEncoder.draw(3, 1, 0, 0)
    passEncoder.end()

    // draw
    device.queue.submit([commandEncoder.finish()])

    // animate
    const theta = Date.now() / 1000;
    uniformData[0] = uniformData[5] = Math.cos(theta);
    uniformData[4] = Math.sin(theta);
    uniformData[1] = -uniformData[4];
    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}

if (navigator.gpu) {
  initialize(
    navigator.gpu,
    document.getElementById('canvas').getContext('webgpu')
  ).then()
} else {
  alert('WebGPU is not supported or is not enabled, see https://webgpu.io')
}
